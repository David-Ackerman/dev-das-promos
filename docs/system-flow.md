# Fluxo completo do sistema

Este documento descreve os principais caminhos de operação do Das Promos: ingestão e avaliação de ofertas, aprovação e publicação, navegação pública, redirecionamento de afiliados e medição de resultados.

```mermaid
flowchart TD
    subgraph Operacao["Operação e entrada"]
        Admin["Painel Admin — Next.js"]
        Login["Login / sessão segura"]
        Manual["Operador inicia ou revisa ofertas"]
        N8N["n8n / integração interna"]
        Schedule["Agendador BullMQ<br/>desativado por padrão"]
        InternalAPI["API interna<br/>token de serviço"]
        AdminAPI["API administrativa<br/>sessão autenticada"]
        Admin --> Login --> AdminAPI
        Admin --> Manual --> AdminAPI
        N8N --> InternalAPI
        Schedule --> Queue
    end

    subgraph Backend["Backend — Fastify e workers"]
        API["API Fastify"]
        Queue["Redis + filas BullMQ"]
        IngestWorker["Worker de ingestão"]
        EvalWorker["Worker de avaliação de ofertas"]
        ContentWorker["Worker de conteúdo e links"]
        PublishWorker["Workers de publicação"]
        Retention["Job de retenção de cliques"]

        InternalAPI --> API
        AdminAPI --> API
        API --> Queue
        Queue --> IngestWorker
        Queue --> EvalWorker
        Queue --> ContentWorker
        Queue --> PublishWorker
        Queue --> Retention
    end

    subgraph Dados["Dados"]
        DB[("PostgreSQL<br/>produtos, ofertas, histórico,<br/>candidatas, publicações e cliques")]
    end

    subgraph Integracoes["Serviços externos"]
        Marketplaces["Marketplaces e provedores<br/>reais ou simulados em desenvolvimento"]
        Affiliate["Plataformas de afiliados<br/>conforme integração e credenciais"]
        OpenRouter["OpenRouter / geração de conteúdo"]
        Channels["Canais externos<br/>Telegram, X e outros habilitados"]
    end

    IngestWorker --> Marketplaces
    IngestWorker -->|"upsert de produtos e ofertas;<br/>registra histórico de preços"| DB
    EvalWorker --> DB
    EvalWorker -->|"pontuação, frescor e decisão"| DB
    EvalWorker -->|"oferta candidata"| Admin

    AdminAPI -->|"aprovar / rejeitar / publicar"| DB
    AdminAPI --> Queue

    ContentWorker --> DB
    ContentWorker -->|"gera conteúdo"| OpenRouter
    ContentWorker -->|"cria link quando suportado"| Affiliate
    ContentWorker -->|"registra publicação e destino"| DB
    ContentWorker -->|"links de redirecionamento /go/:code"| API

    PublishWorker --> DB
    PublishWorker --> Channels
    PublishWorker -->|"resultado da publicação"| DB

    subgraph Publico["Site público e acesso às ofertas"]
        Visitor["Visitante"]
        Web["Site público — Next.js"]
        PublicAPI["API pública<br/>ofertas, produtos, categorias e sitemap"]
        Go["GET /go/:code<br/>valida destino, publicação e frescor"]
        Visitor --> Web
        Web --> PublicAPI
        PublicAPI --> API
        Web -->|"clique no CTA"| Go
    end

    DB --> PublicAPI
    Go --> DB
    Go -->|"registra clique de forma assíncrona"| Queue
    Go -->|"redireciona para o destino afiliado"| Visitor

    subgraph Medicao["Medição e retorno"]
        Analytics["Analytics e métricas"]
        Conversion["Sinais de conversão"]
    end
    DB --> Analytics
    Analytics --> Admin
    Channels -->|"eventos disponíveis"| Conversion
    Conversion --> DB
    Conversion -->|"sinais para pontuação"| EvalWorker
    Retention --> DB
```

### Notas de operação

- O agendador fica desativado por padrão e deve ser habilitado explicitamente no ambiente.
- Provedores simulados servem para desenvolvimento; produção deve usar integrações reais.
- A publicação em cada canal e a geração de links afiliados dependem das integrações e credenciais configuradas.
- A API valida o código, o destino e o estado da oferta antes de redirecionar o visitante.
- Eventos de clique alimentam métricas; sinais de conversão disponíveis podem retornar à avaliação das ofertas.
