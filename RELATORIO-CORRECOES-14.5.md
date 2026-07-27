# Relatório de correções — ChegaJá 14.5.0

## Escopo atendido

A versão reúne as correções solicitadas para o painel do estabelecimento, cálculo de entrega, presença/fila, QR, financeiro do cooperado, escala e SOS.

## Implementação principal

### Estabelecimento

O mapa passou a usar 100% da coluna principal e as janelas receberam uma camada superior à do Leaflet. O formulário de nova entrega foi substituído por um fluxo que exige destino confirmado e consulta a rota antes de permitir o envio. A API ignora valor manual no fluxo do estabelecimento e calcula pela distância, valor por quilômetro e taxa mínima cadastrados.

### Pagamentos e espera

Foram definidos os sete pagamentos permitidos. Cortesia mantém a remuneração calculada da corrida, mas zera o valor a cobrar do destinatário. Rotas de espera recusam entregas de estabelecimento e qualquer sessão antiga desse tipo é encerrada com cobrança zero.

### Presença e fila

O estabelecimento disponibiliza o próprio QR. A leitura e o botão de chegada validam coordenadas, raio, situação ativa, afastamento, escala de trabalho e bloqueio. O raio padrão criado pela migração é 250 metros.

### Financeiro

Entregas canceladas continuam disponíveis para consulta, porém com ganho visual e contábil igual a zero. A tela financeira deriva registros ausentes de todas as entregas concluídas. A migração também cria créditos históricos faltantes e descontos INSS/SEST-SENAT de entregas de estabelecimento.

### Escala

Foi criada uma grade de 14 espaços semanais. O gerenciamento permite trabalho, folga e afastamento. Bloqueios por estabelecimento são conferidos na criação, atualização e troca. Afastamentos cancelam escalas de trabalho do período, geram alerta de retorno e são retirados automaticamente na data cadastrada. Intervalos inferiores a 45 minutos entre locais diferentes geram aviso, sem impedir a escala.

### SOS

O SOS passou a ser consultado em todas as telas do cooperado a cada 12 segundos enquanto o aplicativo está visível. Outros cooperados online veem o botão **Ir ajudar**. A reserva é atômica: somente o primeiro consegue assumir. A operação também pode designar um cooperado online. O ajudante recebe o alerta e a rota, e o solicitante é informado de quem irá ajudá-lo.

## Arquivos centrais

- `migrations/0033_establishment_schedule_sos_rules.sql`
- `src/routes/platform-v19.ts`
- `src/routes/platform-v15.ts`
- `src/routes/platform-v10.ts`
- `src/routes/schedule-v8.ts`
- `src/routes/dispatch-v7.ts`
- `src/routes/driver-experience.ts`
- `public/chegaja-v145.css`
- `public/chegaja-v145.js`

## Observação de validação

Os testes estáticos, a verificação de sintaxe, a verificação TypeScript e a aplicação das migrações foram concluídos. O registro de pacotes retornou HTTP 503, impedindo a instalação integral das dependências e o teste final via Wrangler/navegador neste ambiente.
