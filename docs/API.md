# API de integração — Ligerim 10.3

A chave é vinculada a um estabelecimento, mas é criada, alterada e revogada exclusivamente pela cooperativa responsável. Todo pedido recebido entra como entrega daquele estabelecimento e será atribuído pelo próprio estabelecimento.

## Autenticação

```http
X-API-Key: lig_live_SUA_CHAVE
```

ou:

```http
Authorization: Bearer lig_live_SUA_CHAVE
```

## Regra obrigatória de endereço

Não envie apenas uma frase de endereço. Envie um objeto JSON estruturado com rua, número, cidade e estado. O Ligerim confirma se o número pertence à cidade indicada antes de calcular a distância pelas ruas.

A forma mais segura é:

1. consultar `POST /api/public/address/search`;
2. mostrar as opções ao usuário;
3. selecionar uma opção com `confirmable: true`;
4. enviar o `confirmation_token` na criação do pedido.

### Confirmar endereço

```http
POST /api/public/address/search
Content-Type: application/json
```

```json
{
  "establishment_id": "ID_DO_ESTABELECIMENTO",
  "street": "Avenida Prudente de Morais",
  "number": "1000",
  "neighborhood": "Lagoa Nova",
  "city": "Natal",
  "state": "RN",
  "postal_code": "59056-200"
}
```

Resposta resumida:

```json
{
  "ok": true,
  "items": [
    {
      "formatted_address": "Avenida Prudente de Morais, 1000, Lagoa Nova, Natal - RN",
      "city": "Natal",
      "state_code": "RN",
      "number": "1000",
      "lat": -5.8,
      "lng": -35.2,
      "precision": "rooftop",
      "confirmable": true,
      "confirmation_token": "TOKEN_ASSINADO"
    }
  ]
}
```

Resultados de outra cidade, sem número ou aproximados não podem ser confirmados.

## Criar pedido com token confirmado

```http
POST /api/v1/orders
Content-Type: application/json
```

```json
{
  "external_id": "PED-12345",
  "source": "meu_erp",
  "customer_name": "Maria da Silva",
  "customer_phone": "84999999999",
  "recipient_name": "Maria da Silva",
  "recipient_phone": "84999999999",
  "delivery_confirmation_token": "TOKEN_RETORNADO_PELA_BUSCA",
  "description": "Pedido 12345",
  "payment_method": "pix",
  "notes": "Entregar na portaria"
}
```

O endereço de coleta será o endereço confirmado do estabelecimento.

## Criar pedido com endereço JSON

A API também aceita o JSON e realiza a confirmação no servidor:

```json
{
  "external_id": "PED-12346",
  "source": "meu_erp",
  "customer_name": "João",
  "recipient_name": "João",
  "recipient_phone": "84999999999",
  "delivery_address_json": {
    "street": "Rua São José",
    "number": "1500",
    "neighborhood": "Lagoa Nova",
    "city": "Natal",
    "state": "RN",
    "postal_code": "59054-630"
  },
  "payment_method": "dinheiro",
  "cash_payment_location": "delivery"
}
```

Se o provedor não confirmar o número com precisão, a API retorna erro e não calcula um quilômetro incorreto.

Para dinheiro, `cash_payment_location` é obrigatório:

- `pickup`: pagamento na coleta;
- `delivery`: pagamento na entrega.

## Serviços e preço

```json
{
  "external_id": "PED-12347",
  "source": "meu_erp",
  "delivery_confirmation_token": "TOKEN",
  "service_ids": ["ID_SERVICO_1"],
  "payment_method": "pix"
}
```

Sem `amount`, o valor é calculado por:

```text
maior entre taxa mínima e quilômetros da rota × valor por km
+ serviços adicionais
```

Para definir o valor no sistema externo, envie `amount` em reais.

## Resposta

```json
{
  "ok": true,
  "order": {
    "id": "uuid",
    "display_code": "LOJA-000001",
    "external_id": "PED-12345",
    "status": "new",
    "charge_cents": 1400,
    "distance_meters": 4200,
    "duration_seconds": 720,
    "confirmation_code": "5831",
    "tracking_enabled": true,
    "tracking_url": "https://seu-dominio/r/token"
  }
}
```

O link será `null` quando a cooperativa desativar o rastreamento daquele estabelecimento. O mesmo `source + external_id` não cria duplicidade.

## Consultar pedido

```http
GET /api/v1/orders/PED-12345?source=meu_erp
```

## Cancelar pedido

```http
POST /api/v1/orders/PED-12345/cancel?source=meu_erp
Content-Type: application/json
```

```json
{
  "reason": "Cliente cancelou"
}
```

## Webhooks

Eventos:

- `delivery.created`;
- `delivery.assigned`;
- `delivery.updated`;
- `delivery.status_changed`.

Assinatura:

```http
X-Ligerim-Signature: assinatura_hmac
```

## Status

- `new`;
- `assigned`;
- `accepted`;
- `to_pickup`;
- `at_pickup`;
- `picked_up`;
- `in_route`;
- `delivered`;
- `cancelled`;
- `problem`.


## Mensagens, confirmação e rastreamento

Cada entrega recebe um `tracking_token`. O código de quatro dígitos e o chat respeitam a regra configurada no estabelecimento. A atribuição, troca de cooperado, retirada da atribuição e oferta aos cooperados elegíveis são feitas pelo painel do estabelecimento.

A API externa não deve receber nem expor chaves internas de usuário. Guarde a chave do estabelecimento no servidor do sistema integrado e nunca no JavaScript público.
