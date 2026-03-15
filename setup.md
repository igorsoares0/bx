# bxapp — Setup Dev & Produção

## Estrutura

| Ambiente | Shopify App Config | Banco de Dados | Deploy |
|---|---|---|---|
| Dev | `shopify.app.dev.toml` | Neon (dev) | `shopify app dev` (local) |
| Prod | `shopify.app.prod.toml` | Neon (prod) | `git push` → Vercel |

---

## 1. Configurar a Vercel

No dashboard da Vercel, vá em **Settings → Environment Variables** e adicione:

| Variável | Valor |
|---|---|
| `SHOPIFY_APP_URL` | `https://bx-two.vercel.app` |
| `SHOPIFY_API_KEY` | Client ID do app de produção |
| `SHOPIFY_API_SECRET` | Client Secret do app de produção |
| `SCOPES` | `read_discounts,write_discounts,write_products,read_orders` |
| `DATABASE_URL` | URL do banco Neon de **produção** |
| `NODE_ENV` | `production` |

---

## 2. Configurar Dev Local

Crie o arquivo `.env` na raiz (já está no `.gitignore`):

```env
DATABASE_URL='postgresql://...'  # URL do banco Neon de DEV
```

As variáveis `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` e `SHOPIFY_APP_URL` são injetadas automaticamente pelo `shopify app dev`.

---

## 3. Comandos Úteis

### Dev local

```bash
# Selecionar config de dev
shopify app config use dev

# Rodar o app localmente
shopify app dev

# Gerar migration do Prisma
npx prisma migrate dev --name nome_da_migration

# Abrir o banco de dev no browser
npx prisma studio
```

### Produção

```bash
# Selecionar config de prod
shopify app config use prod

# Registrar webhooks e extensões no app de produção
shopify app deploy

# Deploy do código (a Vercel faz o build automaticamente)
git push

# Aplicar migrations no banco de produção manualmente
DATABASE_URL='postgresql://...(prod)' npx prisma migrate deploy
```

### Prisma (geral)

```bash
# Gerar o client após alterar o schema
npx prisma generate

# Ver o estado das migrations
npx prisma migrate status

# Reset do banco (CUIDADO: apaga todos os dados)
npx prisma migrate reset
```

---

## 4. Fluxo de Trabalho

1. Desenvolva localmente com `shopify app dev` (usa banco de dev)
2. Teste as mudanças na loja de desenvolvimento
3. Commit e `git push` → Vercel faz deploy automático
4. Se alterou o schema do Prisma, rode `prisma migrate deploy` apontando pro banco de produção
5. Se alterou webhooks/extensões, rode `shopify app deploy` com config de prod
