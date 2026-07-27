# ChegaJá 14.15.9 — gestão completa de entregas, escalas e financeiro

## Correções principais da versão 14.15.9

### Mapas configuráveis no Administrador Master

- O Administrador Master escolhe entre **Google Maps** e **OpenStreetMap** em **Configurações → Mapas e endereços**.
- As chaves Google do servidor e do navegador e o Map ID passam a ser configurados dentro do sistema, sem reinstalar o projeto.
- Ao selecionar Google Maps, o sistema usa Google para o mapa, pesquisa de endereços, geocodificação e rotas; falhas de chave, API, restrição ou faturamento são exibidas claramente, sem trocar escondido para outro provedor.
- Ao selecionar OpenStreetMap, nenhuma API do Google é usada.
- O Administrador Master pode testar a configuração antes de salvar e pode desligar o Google posteriormente para controlar custos.

### Atendente da Base

- Quando a cooperativa possui apenas uma Base ativa, o cadastro de **Atendente da Base** vincula essa Base automaticamente.
- Não é necessário selecionar nem cadastrar outra Base.
- Quando existem várias Bases, o sistema pede qual delas o atendente poderá acessar.
- O atendente abre o painel da Base vinculada e visualiza somente os dados autorizados.

### Matrícula permanente e histórico do cooperado

- O campo **Matrícula** foi acrescentado ao cadastro do cooperado, no padrão `0001-26`.
- O número sequencial é permanente na cooperativa e o sufixo representa o ano de ingresso.
- Depois que os cooperados existentes tiverem suas matrículas informadas, o próximo cadastro recebe automaticamente a próxima sequência disponível.
- Excluir um cooperado apenas o torna **inativo**: o acesso, a fila e o estado online são bloqueados, mas entregas, escalas, avaliações, produção, pagamentos e demais históricos permanecem.
- Ao cadastrar novamente o mesmo CPF e o mesmo nome, o sistema reativa o registro original, mantendo a mesma matrícula e todo o histórico.
- Uma sessão que já estava aberta também perde acesso assim que o cooperado é inativado.

### Recursos anteriores preservados

- Cópia fiel da escala da semana anterior para a semana seguinte, mudando apenas as datas.
- Posição do cooperado na fila.
- Complemento de garantido incluído na produção do cooperado e da cooperativa.
- Relatório semanal de complementos.
- Avaliações vitalícias sem identificar quem avaliou.
- Logo do estabelecimento no painel correspondente.

## Banco de dados

A migração mais recente é `0044_master_maps_driver_registry.sql`. Ela é aplicada automaticamente pelo atualizador local ou pelo processo de publicação e não apaga os cadastros existentes.

Sistema multi-cooperativa de entregas para Cloudflare Workers e D1.

## ChegaJá 14.15.0 — corridas e complemento do garantido

- A entrega concluída no estabelecimento é identificada automaticamente pelo cooperado, estabelecimento e horário em que foi lançada.
- O cálculo converte corretamente os horários automáticos do banco para o fuso de Brasília antes de comparar com a escala.
- A soma das corridas usa primeiro o crédito financeiro efetivamente lançado para o cooperado, com compatibilidade para registros antigos.
- Exemplo validado: corrida de R$ 36,64 em turno garantido de R$ 110,00 gera complemento de R$ 73,36.
- Corrida e complemento permanecem como dois créditos separados e totalizam R$ 110,00 na produção do cooperado.
- A tela de fechamento recalcula individualmente os turnos do período filtrado; o botão **Ajustar total** fica reservado para exceções.
- Cada corrida continua vinculada a apenas um turno, sem duplicidade.
- Na versão atual, a migração mais recente é `0044_master_maps_driver_registry.sql`; ela acrescenta matrícula permanente e configurações de mapas do Administrador Master.


## Principais correções da versão 14.8.2

- cooperados exibidos um abaixo do outro em uma área própria de configuração;
- clique no cooperado para registrar afastamento, selecionar bloqueios e acrescentar escala;
- 14 escalas padrão por cooperado ativo, duas por dia de segunda a domingo;
- ordenação por cooperado, contrato/local, turno ou dia/data;
- filtros independentes por cooperado, contrato/local, turno e dia/data;
- Base aparece somente uma vez;
- estabelecimento vinculado a contrato não aparece como segunda opção duplicada;
- cada contrato, estabelecimento ou Base possui seu próprio leque de horários cadastrados;
- ao selecionar o local na escala, aparecem somente os horários cadastrados especificamente para esse contrato, estabelecimento ou Base;
- a linha permanece no lugar enquanto o contrato e o horário estão sendo selecionados;
- o mapa da Base ocupa toda a largura disponível da coluna principal;
- a tela de contratos não exibe mais o botão quebrado de valores antigos e oferece acesso direto aos horários;
- autosalvamento de alterações no rascunho e publicação somente em **Enviar escala**;
- alerta quando um cooperado termina em um local e começa no mesmo horário ou em até 45 minutos em outro local;
- nenhum alerta de deslocamento quando as duas escalas são no mesmo local;
- alerta de sobreposição e quantidade de repetições no mesmo turno, sem bloquear a montagem;
- quantidade de escalados por contrato/local e horário;
- trocas impedidas para cooperado afastado ou bloqueado no estabelecimento;
- trocas com sobreposição ou pouco tempo de deslocamento geram atenção, mas permanecem permitidas;
- exportação em CSV para Excel e impressão/PDF somente no acesso interno da cooperativa, não no acesso do cooperado.

A migração mais recente é `0037_schedule_base_scope_repair.sql`. Ela corrige horários e escalas antigas da Base que estavam vinculados ao estabelecimento virtual ou ao antigo contrato técnico chamado BASE.

Consulte `CORRECOES-14.8.2.txt`, `TESTES-REALIZADOS-14.8.2.txt` e `LEIA-ME-PRIMEIRO.txt`.

## Histórico da versão anterior

### Principais correções da versão 14.6.1

### Cadastros sem camada sobre o formulário

- a camada escura permanece atrás da caixa branca;
- campos, listas, textos e botões permanecem nítidos e clicáveis;
- clicar dentro do cadastro não fecha a janela;
- a janela fecha somente pelos botões de fechar ou cancelar;
- a correção é geral e atende Cooperativas, Usuários, Cooperados, Estabelecimentos, Contratos, Bases e demais formulários que usam o modal central.

### Base carregando corretamente

- a tela consulta diretamente o catálogo de Bases da cooperativa;
- o carregamento não transforma falha de API em lista vazia;
- há estado de carregamento, mensagem de erro e botão **Tentar carregar novamente**;
- quando não existe Base cadastrada, aparece o botão para cadastrar a primeira;
- mapa, fila, entregas e atualização automática continuam no mesmo painel.

### Escala da próxima semana com 14 linhas

- cada cooperado ativo possui 14 linhas, sendo dois espaços por dia de segunda a domingo;
- a próxima semana é selecionada por padrão e mostra as datas corretas;
- cada linha permite trocar cooperado, contrato ou **FOLGA**, horário predefinido, início e fim;
- as alterações ficam salvas em rascunho e podem ser feitas em qualquer dia;
- a escala ativa só é substituída ao clicar em **Enviar escala**;
- **AFASTADO** é definido pela data do afastamento e aparece automaticamente nas linhas correspondentes;
- um botão abre o afastamento para informar início, retorno e motivo;
- outro botão abre o bloqueio para selecionar estabelecimentos em que o cooperado não pode trabalhar;
- afastamento e bloqueio são validados ao salvar a linha e novamente ao publicar;
- horários sobrepostos ou com menos de 45 minutos entre locais diferentes mostram aviso, sem impedir o administrador de manter a escala.

### Recursos anteriores preservados

- mapa principal do estabelecimento, preço automático por quilômetro e QR de check-in;
- fila limitada à proximidade configurada;
- pagamentos PIX, dinheiro, cartões, vale-alimentação, vale-refeição e cortesia;
- entregas canceladas fora dos ganhos;
- INSS e SEST/SENAT nas entregas de estabelecimento;
- SOS para outros cooperados, reserva de ajuda, designação e abertura da rota.

### Banco e validação

- migração mais recente: `0035_schedule_spreadsheet.sql`;
- 35 migrações aplicadas em sequência em banco SQLite novo;
- consulta do catálogo da Base executada sobre o banco migrado;
- sintaxe dos arquivos JavaScript verificada;
- três testes estáticos de regressão aprovados;
- interação do modal validada em navegador isolado: campos permaneceram abertos e clicáveis, e cancelar fechou corretamente;
- a publicação real no Cloudflare não foi executada neste ambiente;
- o typecheck completo depende de concluir `npm install` no computador de publicação.

## Testar localmente

Extraia o ZIP em uma pasta nova. Abra o PowerShell nessa pasta e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\CONFIGURAR_LOCAL.ps1
.\INICIAR_LOCAL.bat
```

Abra o endereço exibido depois de `Ready on` e pressione `Ctrl + Shift + R` no primeiro acesso.

## Atualizar o Cloudflare

Para um sistema já publicado, execute:

```powershell
.\ATUALIZAR_CLOUDFLARE.bat
```

Ou, mantendo o `database_id` correto no `wrangler.jsonc`:

```powershell
npm install
npm run db:migrate:remote
npm run deploy
```

Não envie `.dev.vars`, `.wrangler` ou `node_modules` ao GitHub.

## O que foi corrigido na versão 13.2

### Cliente vinculado à cooperativa correta

- o cliente não escolhe cooperativa no cadastro nem no pedido;
- a cooperativa vem do link oficial `?cliente=1&coop=CODIGO`;
- link inválido ou de cooperativa inativa bloqueia o cadastro;
- cadastro concluído cria a sessão e entra automaticamente;
- login, crédito, pedidos e histórico permanecem vinculados à mesma cooperativa;
- o vínculo fica salvo quando o cliente instala ou reabre o aplicativo;
- painel do cliente em página única, com mapa, crédito disponível, pedido, rastreio, chat e histórico;
- após confirmar coleta e entrega, o sistema calcula e mostra o valor antes do pedido;
- cliente cadastrado não confirma corrida quando o crédito não cobre o valor;
- solicitação de crédito permanece pendente e visível até aprovação ou recusa.

### Tela da Base sem retirada de funções

- mantém as funções existentes da Base e reorganiza o layout;
- mapa, formulário, fila, cooperados online e entregas ficam na mesma operação;
- entregas não atribuídas aparecem primeiro; atribuídas e em andamento ficam abaixo;
- Cliente, Coleta, Entrega, Cooperado, Valor e Status podem ser clicados para abrir a edição completa;
- botão compacto para atribuir cooperado elegível;
- link de rastreio avulso restaurado em formato de ícone;
- ações longas substituídas por ícones com descrição ao passar o mouse;
- botão para marcar todas as entregas ativas do dia como entregues;
- distribuição automática pode ser ligada ou desligada por Base;
- recusas e ausência de resposta passam a oferta ao próximo cooperado;
- motivo da recusa fica registrado e aparece para a Base;
- fila rápida aparece ao lado da Base e atualiza automaticamente;
- painel do atendente mantém a mesma estrutura da Base;
- somente administrador da cooperativa ou Master cadastra atendentes e define permissões.

### Aplicativo do cooperado

- um único sistema de navegação: menu sanduíche e barra inferior;
- menu lateral antigo fica oculto para não duplicar opções;
- SOS disponível mesmo sem entrega ativa;
- chamadas diretas pelo celular para Polícia 190, SAMU 192 e Bombeiros 193;
- alerta interno de SOS para Base e cooperados online;
- botão para entrar na fila somente quando escalado, online e a até 30 metros da Base;
- presença permanece na fila numerada até sair, ser chamado ou ficar inelegível;
- ao aceitar uma entrega, o servidor confirma o aceite e a tela muda para o mapa da corrida;
- mapa mostra localização, coleta, entrega e rota;
- oferta mostra km até a coleta, km total, tempo, combustível estimado e valor a receber;
- recusa exige motivo obrigatório e a Base visualiza o motivo.

### Espera, crédito e pagamento

- contador de espera com contraste e leitura adequada no celular;
- corrida já paga não volta a aparecer inteira como pendente;
- somente espera ou adicional ainda não pago fica em aberto;
- Base pode marcar somente o restante como pago;
- restante também pode ser debitado do crédito quando houver saldo;
- histórico registra compras, ajustes, corridas, espera e saldo final.

### Validação técnica

- consultas ajustadas para não ultrapassar o limite de colunas do D1;
- 32 migrações validadas em banco D1 novo;
- TypeScript e todos os arquivos JavaScript verificados;
- cadastro, sessão automática, login, carteira e solicitação pendente de crédito testados pela API local;
- rota de saúde e servidor local validados.

## Testar localmente

Extraia o ZIP em uma pasta nova. Abra o PowerShell nessa pasta e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\CONFIGURAR_LOCAL.ps1
```

Depois:

```powershell
.\INICIAR_LOCAL.bat
```

Abra exatamente o endereço exibido depois de `Ready on`. Pode ser `8787`, `8788` ou outra porta disponível. Mantenha o PowerShell aberto durante o teste e pressione `Ctrl + F5` no primeiro acesso.

## GitHub e Cloudflare

O `.gitignore` bloqueia `node_modules`, `.wrangler`, `.dev.vars`, `.env` e logs.

Para publicar no Cloudflare:

```powershell
.\PUBLICAR_CLOUDFLARE.bat
```

O instalador localiza ou cria o D1, aplica as 32 migrações, cria a chave JWT, configura o Administrador Master e publica o Worker.

## Observações

- O SOS telefônico abre o discador; o próprio aparelho pede a confirmação final da chamada.
- O mapa do aplicativo acompanha a operação e agora também faz a navegação interna até a coleta e a entrega, sem abrir um aplicativo externo.
- Nunca envie `.dev.vars` ao GitHub.


## Acesso da cooperativa — versão 13.3

Ao cadastrar uma cooperativa, informe:

- **E-mail institucional / contato:** endereço público da cooperativa.
- **E-mail de acesso do administrador:** endereço pessoal usado pelo administrador.
- **Senha inicial:** mínimo de 8 caracteres.

O administrador poderá entrar usando qualquer um dos dois e-mails com a mesma senha. O Master pode editar o acesso e definir uma nova senha abrindo **Cooperativas > Editar**.


## ChegaJá 14.0

Consulte `ATUALIZACOES-14.0.txt` e `TESTES-REALIZADOS-14.0.txt` para a lista completa das correções e validações desta versão.

## Versão 14.3.1

Esta versão consolida o painel da Base, aplicativo do cooperado, cliente e estabelecimento. Inclui edição rápida por campo, mapas estáveis, upload de logo por arquivo, SOS com designação de ajuda, avaliações, histórico por período e redução de consultas repetidas. Consulte `ATUALIZACOES-14.3.txt` e `TESTES-REALIZADOS-14.3.txt`.

## Versão 14.4.2

Esta versão completa o aplicativo do cooperado com aba **Escala**, datas e horários exatos, histórico, avaliações com critérios e variação de 0,01, configurações de acesso, suporte por e-mail, ajuda pesquisável, foto aprovada pela cooperativa, controle de CNH/CRLV por número e validade, suspensão automática configurável e navegação interna no próprio ChegaJá. A revisão 14.4.2 corrige a clonagem de entrega no D1, permite troca de escala entre cooperados mantendo Base, contrato, data e horário, consolida solicitações inversas em uma única confirmação e deixa somente o menu lateral azul completo. Também mantém as correções de SOS, nota, navegação, avaliação, produto/refeição e ganhos da revisão anterior. Consulte `ATUALIZACOES-14.4.txt` e `TESTES-REALIZADOS-14.4.txt`.
## Correção 14.8.4

- O mesmo estabelecimento pode ter vários horários cadastrados.
- O formulário envia apenas um alvo operacional por horário.
- Ao escolher o estabelecimento ou contrato na escala, aparecem todos os horários dele.
- A migração 0039 corrige vínculos antigos que possuíam dois alvos preenchidos.

## Atualização 14.11.0

- Entregas da Base podem ser imediatas ou agendadas por data e horário.
- Atribuição opcional: sem cooperado, manual ou automática.
- Busca de endereço durante a digitação, com foco em Natal/RN, teclado e nomes de lugares.
- Complemento do cliente pode receber automaticamente o nome do estabelecimento pesquisado.
- Avaliações da cooperativa carregam somente o dia atual por padrão e aceitam período e cooperado.
- A clonagem abre a atribuição e permite selecionar qualquer cooperado ativo sem afastamento.
- Clientes registrados usam a área própria do cliente; os acessos internos continuam separados por segurança.
- Migração adicionada: `0040_scheduled_delivery_dispatch.sql`.

### Teste local

```powershell
powershell -ExecutionPolicy Bypass -File .\CONFIGURAR_LOCAL.ps1
.\INICIAR_LOCAL.bat
```



## Atualização 14.11.0

- Adiantamento solicitado pelo cooperado somente até o saldo líquido disponível.
- Ordem de descontos: INSS, SEST/SENAT, adiantamento, rateios e demais despesas.
- Histórico administrativo de trocas de escala.
- Exibição de registros no fuso de Brasília/São Paulo.

## ChegaJá 14.15.0

### Financeiro corrigido

- A tela diferencia **Produção para fechamento** de **Produção já recebida**.
- Toda entrega de estabelecimento entra na produção para fechamento e recebe INSS e SEST/SENAT conforme as alíquotas da cooperativa.
- Na Base, somente **PIX Cooperativa** e **Crédito pré-pago/antecipado** entram na produção para fechamento e podem quitar descontos.
- Somente PIX comum e dinheiro da Base são produção já recebida diretamente pelo cooperado e não quitam descontos no fechamento. Cartões e vales servem apenas para informar como o produto ou a refeição será cobrado no estabelecimento; não são ganho do cooperado.
- O saldo pode ficar negativo quando os descontos ultrapassam a produção realmente disponível para fechamento.
- Na prévia, o sistema informa se o desconto será pago, pago parcialmente ou continuará aberto. O status muda definitivamente para **Pago** quando a cooperativa clicar em **Fechar semana**.
- Quando o saldo não cobre tudo, somente o restante segue aberto para a próxima semana, com a descrição da semana de origem.
- Identificadores internos como `lote 31df2eb4` não aparecem mais nas telas nem nas exportações.
- A prioridade de quitação é: INSS, SEST/SENAT, adiantamentos, impostos/rateios e demais despesas.
- Cancelamentos recalculam o saldo e reabrem descontos quando a produção que os quitava deixou de existir.

### Endereços em todo o Rio Grande do Norte

- A busca não fica limitada a Natal.
- Endereços e nomes de empresas/locais podem ser encontrados em qualquer município do RN.
- Com a chave Google ativa, a busca usa Google Places e Geocoding; sem a chave, utiliza a alternativa gratuita.
- As sugestões continuam aceitando clique, setas do teclado e Enter.

### Garantido e fechamento de turno

- Cada estabelecimento pode definir um garantido diferente para cada dia da semana.
- Ao fim do turno, o sistema soma somente o valor das corridas do cooperado naquele estabelecimento.
- Quando a soma ficar abaixo do garantido, lança somente a diferença como **Complemento de garantido**, com INSS e SEST/SENAT.
- O estabelecimento pode ajustar o total quando uma corrida concluída depois do horário pertencia ao mesmo cooperado.
- A avaliação ao fim do turno é opcional e exclusiva do estabelecimento; a Base não avalia.

### Migração

A migração mais recente é `0042_weekly_closing_guarantees_shift_ratings.sql`. Ela consolida a liquidação no fechamento semanal, corrige formas de recebimento da Base, adiciona o garantido diário por estabelecimento, ajustes de turno e avaliações opcionais do cooperado pelo estabelecimento.

### Teste local

```powershell
powershell -ExecutionPolicy Bypass -File .\CONFIGURAR_LOCAL.ps1
.\INICIAR_LOCAL.bat
```
