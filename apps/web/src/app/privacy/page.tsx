import { Nav } from "@/components/nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacidade",
  description:
    "Como o das promos trata os dados técnicos gerados ao acessar ofertas e usar links de saída.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const operator = process.env.PUBLIC_OPERATOR_NAME?.trim() || "Identificação do operador pendente";
  const email = process.env.PUBLIC_CONTACT_EMAIL?.trim();

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Privacidade</h1>
        <p className="mt-3 text-sm text-neutral-500">Atualizada em 29 de setembro de 2026</p>

        <div className="mt-8 space-y-7 leading-7 text-neutral-700">
          <section>
            <h2 className="text-xl font-semibold text-neutral-950">Quem opera o site</h2>
            <p className="mt-2">Operador: {operator}.</p>
            {email ? (
              <p className="mt-2">
                Para dúvidas ou solicitações sobre dados pessoais, escreva para{" "}
                <a className="text-blue-700 underline" href={`mailto:${email}`}>
                  {email}
                </a>
                .
              </p>
            ) : (
              <p className="mt-2">O canal de contato ainda não foi configurado.</p>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-950">Dados tratados</h2>
            <p className="mt-2">
              Quando alguém abre um link de oferta, registramos o identificador do redirecionamento
              e da oferta, a origem/campanha quando disponível, a data e hora, e dados técnicos
              resumidos da requisição. Os parâmetros de campanha aceitos (utm_source, utm_medium e
              utm_campaign) são guardados no evento de clique para atribuição interna e não são
              encaminhados à loja. O endereço IP é convertido em um hash com segredo do servidor e
              truncado; o endereço original não é gravado. O navegador é reduzido a uma categoria
              aproximada (celular ou computador e navegador), e o referenciador é reduzido à origem
              HTTP(S), sem caminho ou parâmetros.
            </p>
            <p className="mt-2">
              Usamos esses registros para medir cliques e o desempenho das ofertas e manter
              relatórios internos. O registro de clique é enviado em segundo plano e não é
              necessário criar uma conta para navegar no site.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-950">
              Links de afiliados e terceiros
            </h2>
            <p className="mt-2">
              Alguns links levam a lojas e podem gerar comissão para o operador, sem custo adicional
              indicado ao visitante. Ao seguir um link, você passa a interagir com o site da loja; a
              loja e seus parceiros podem tratar dados conforme as próprias políticas. A
              identificação do link de afiliado pode permitir atribuir uma compra ou visita ao nosso
              site.
            </p>
            <p className="mt-2">
              As imagens dos produtos são carregadas diretamente pelo seu navegador a partir dos
              servidores de imagens dos marketplaces. Esses servidores recebem dados técnicos
              necessários à conexão, como seu endereço IP e informações do navegador; o site
              configura essas requisições para não enviar o endereço da página como referenciador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-950">
              Armazenamento e compartilhamento
            </h2>
            <p className="mt-2">
              Os eventos de clique são armazenados no banco de dados do serviço e excluídos
              diariamente após o prazo configurado, que é de 180 dias por padrão. A exclusão também
              remove os dados técnicos resumidos e os parâmetros de campanha daquele evento; os
              relatórios de cliques anteriores ao prazo deixam de estar disponíveis. A hospedagem e
              os provedores técnicos necessários para operar o site podem processar dados em nome do
              operador. Não usamos os eventos de clique para criar perfis de publicidade no
              navegador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-950">Cookies</h2>
            <p className="mt-2">
              O site público não grava cookies para sua medição de cliques. A área administrativa
              pode usar cookie de sessão para autenticar operadores; esse cookie não é necessário
              para navegar nas ofertas públicas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-950">Solicitações</h2>
            <p className="mt-2">
              Você pode entrar em contato pelo canal acima para perguntar sobre o tratamento de
              dados ou encaminhar uma solicitação. Para informações gerais sobre direitos de
              titulares, consulte a{" "}
              <a
                className="text-blue-700 underline"
                href="https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares"
                target="_blank"
                rel="noreferrer"
              >
                orientação da ANPD
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-10 border-t border-neutral-200 pt-5 text-sm text-neutral-500">
          <Link href="/" className="text-blue-700 underline">
            Voltar às ofertas
          </Link>
        </p>
      </main>
    </div>
  );
}
