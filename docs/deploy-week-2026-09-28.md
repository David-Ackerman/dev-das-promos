# Plano de deploy: 28 de setembro a 2 de outubro de 2026

Objetivo: publicar o site e o painel com uma API HTTPS, dados reais de ao
menos um marketplace, um canal real de publicação e um caminho de retorno
seguro. A ativação automática fica condicionada às credenciais e à
verificação de um link afiliado real. Use `docs/aws-deployment.md` para
os comandos completos de AWS, EC2 e Vercel.

| Data | Entrega | Critério para avançar |
| --- | --- | --- |
| **Segunda, 28/9** | Confirmar o domínio público do site (raiz ou `www`), `api.<domínio>` e `admin.<domínio>`, além do acesso AWS/Vercel/GitHub, conta de afiliado Shopee e bot Telegram. Criar os registros DNS da API e do painel; preparar o registro do site público para o host escolhido na Vercel. Integrar as correções, exigir CI nos pull requests e gerar segredos novos. | CI verde; DNS da API aponta para a VM planejada; os três hostnames finais estão definidos; credenciais reais disponíveis ou bloqueio registrado. |
| **Terça, 29/9** | Criar/validar CloudFormation, EC2 e o stack Compose. Definir `API_HOST`, `POSTGRES_PASSWORD`, URLs HTTPS e `SESSION_COOKIE_DOMAIN`. Subir Postgres/Redis, migrar, subir API/Caddy. Configurar backup fora da VM. | `https://api.<domínio>/ready` retorna 200; porta 4000 não responde publicamente; um backup foi salvo fora da VM. |
| **Quarta, 30/9** | Criar o admin com `db:bootstrap-admin`, inserir as comissões reais, implantar web e painel na Vercel com um plano que permita uso comercial (ou em host compatível) e anexar os hostnames finais da API, do site público e do painel. Definir `PUBLIC_OPERATOR_NAME` e `PUBLIC_CONTACT_EMAIL`; revisar a página `/privacy` com os dados reais de hospedagem e retenção. Conferir login e páginas protegidas após recarregar. | Plano/host compatível selecionado; DNS e TLS ativos nos três hostnames; identificação e contato reais exibidos em `/privacy`; política revisada pelo operador; login funciona após refresh; site e painel acessam a API por HTTPS; nenhuma oferta mock aparece no banco público. |
| **Quinta, 1/10** | Fazer uma ingestão manual Shopee, conferir preço/histórico/pontuação, aprovar uma oferta e publicar no Telegram e no canal web. Confirmar que a oferta aparece no site público com CTA próprio; abrir o `/go/:code` e validar destino e atribuição do canal web. Testar um clique e seu registro. | Um ciclo completo real funciona; a página pública só aparece após a publicação web; o CTA leva ao produto correto e conta o clique como web; não há publicação duplicada. |
| **Sexta, 2/10** | Habilitar o agendamento inicialmente com um horário UTC e limite de uma oferta. Acompanhar logs, fila, falhas de integração e disponibilidade; ensaiar restauração do backup e reversão da versão. | Primeira execução automática validada e plano de retorno testado. Se falhar, manter `SCHEDULE_ENABLED=false` e corrigir antes de abrir o tráfego. |

## Dependências que podem atrasar o lançamento

- A liberação das APIs de afiliados depende das contas dos marketplaces.
  Se a Shopee não estiver liberada até quinta-feira, mantenha o site
  público sem ofertas e o agendamento desligado; não publique dados mock
  como promoções reais. Amazon entra somente após uma ingestão real
  conferida. Mercado Livre fica fora de `SCHEDULE_MARKETPLACES` enquanto
  não houver geração suportada de links afiliados.
- Use os domínios finais `api.<domínio>` e `admin.<domínio>` sob o mesmo
  domínio principal. Configure `SESSION_COOKIE_DOMAIN=.<domínio>` na API.
  Um domínio padrão `*.vercel.app` para o painel não compartilha o cookie
  com uma API em outro domínio.
- O site monetiza por links de afiliados. A Vercel restringe o plano Hobby
  a projetos pessoais e não comerciais; escolha Pro/Enterprise ou outro
  host que permita uso comercial e confira os custos atuais antes do deploy
  (`docs/aws-deployment.md`, Parte 4).
- Mantenha `SCHEDULE_ENABLED=false` durante a preparação. Só ligue a
  rotina depois do ciclo manual com credenciais reais.
- A página `/privacy` documenta o rastreamento de cliques atual, mas exige
  identificação e contato reais. O API elimina diariamente eventos fora da
  janela `CLICK_EVENT_RETENTION_DAYS` (180 dias por padrão); confirme o prazo
  e alinhe qualquer alteração com o texto público antes de abrir tráfego.

## Operação e retorno

1. Antes do primeiro tráfego, instale e execute
   `infra/backup/backup-postgres.sh` pelo timer `systemd` documentado em
   `docs/aws-deployment.md`. Ele envia um `pg_dump` customizado e seu
   SHA-256 para o bucket S3 privado, com versionamento e retenção. Confirme
   a restauração em um banco separado. Um volume Docker na mesma VM não é
   backup.
2. Acompanhe `docker compose -f infra/docker/docker-compose.prod.yml logs
   --tail=200 api caddy`, o status `/ready`, o painel de publicações e as
   falhas do workflow de deploy. Configure alerta externo para indisponibilidade
   da URL `/ready` e para falhas do job de deploy. Para o monitor de uptime
   do repositório, configure `API_HEALTHCHECK_URL` e `PUBLIC_HEALTHCHECK_URL`
   nas variáveis GitHub. A conta que editar o cron por último deve acompanhar
   o repositório e habilitar notificações de falha do Actions.
3. Se a publicação automática falhar, desligue `SCHEDULE_ENABLED` e
   reinicie a API; jobs agendados que ainda aguardavam processamento são
   descartados pelos workers enquanto a chave estiver desligada. A rotina
   não seleciona novamente ofertas que já tenham qualquer registro de
   publicação; retries ficam no painel para exigir inspeção humana. Confira
   no BullMQ se havia uma chamada externa em andamento e verifique o
   canal antes de repetir. Se a geração falhou antes de criar uma
   publicação, use **Publish** no detalhe da oferta para reenfileirar. No
   painel de publicações, o administrador pode tentar novamente itens
   `failed` ou parados há mais de 10 minutos. Antes de repetir um item
   `failed` ou `publishing`, confira o canal externo: uma resposta com
   erro ou timeout pode ocorrer depois do envio. O painel pede confirmação
   antes desses retries; se uma nova ingestão atualizou a oferta, o retry
   regenera o conteúdo com o snapshot atual antes de publicar. Uma oferta
   atualizada deixa de aparecer no site até ser publicada de novo; use
   **Publish** no detalhe do deal para gerar o novo snapshot nos canais
   configurados. Confira as postagens externas antigas antes de republicar.
   Para reverter código, abra um PR com `git revert` do commit causador;
   após CI verde e merge, o workflow de deploy aplica a versão revertida.
   Uma migração incompatível exige restauração do backup testado antes de
   reabrir o tráfego.

## Pendências após a primeira semana

Criar limpeza persistente dos status de ofertas antigas, atribuição de conversões por
canal e edição do agendamento no painel. Esses itens estão detalhados
em `docs/roadmap.md`; não são pré-requisitos para o ciclo inicial com
revisão manual, mas devem entrar no planejamento da próxima etapa.
