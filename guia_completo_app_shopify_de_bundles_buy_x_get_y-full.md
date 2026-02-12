# Guia Completo — App Shopify de Bundles Buy X Get Y (BXGY)

> Do zero ao deploy: como construir um app Shopify completo de bundles BXGY com desconto nativo no checkout, widget interativo no tema e painel admin.

---

## Indice

1. [Visao Geral](#1-visao-geral)
2. [Arquitetura](#2-arquitetura)
3. [Stack Tecnologica](#3-stack-tecnologica)
4. [Setup Inicial](#4-setup-inicial)
5. [Configuracao do App Shopify](#5-configuracao-do-app-shopify)
6. [Banco de Dados (Prisma + SQLite)](#6-banco-de-dados-prisma--sqlite)
7. [Autenticacao e Sessoes](#7-autenticacao-e-sessoes)
8. [Rotas do Admin (Remix)](#8-rotas-do-admin-remix)
9. [Gerenciamento de Metafields](#9-gerenciamento-de-metafields)
10. [Shopify Function — Desconto em Rust](#10-shopify-function--desconto-em-rust)
11. [Theme Extension — Widget Interativo](#11-theme-extension--widget-interativo)
12. [Theme Extension — Auto-Add no Carrinho](#12-theme-extension--auto-add-no-carrinho)
13. [Webhooks](#13-webhooks)
14. [Deploy e Docker](#14-deploy-e-docker)
15. [Edge Cases e Tratamento de Erros](#15-edge-cases-e-tratamento-de-erros)
16. [Checklist de Aprovacao na Shopify App Store](#16-checklist-de-aprovacao-na-shopify-app-store)
17. [Fluxo Completo de Dados](#17-fluxo-completo-de-dados)

---

## 1. Visao Geral

### O que e um Bundle BXGY?

> "Compre **2 camisetas** e ganhe **1 bone com 50% de desconto**"

Caracteristicas:
- O desconto e aplicado **somente no produto reward (Y)**
- O estoque continua individual por produto (nao e um produto combinado)
- O desconto e **nativo do checkout Shopify** via Shopify Functions
- Funciona com desconto percentual ou valor fixo
- Suporta limite maximo de itens reward por pedido

### O que o app faz

| Componente | Funcao |
|-----------|--------|
| **Admin Panel** | Interface para criar/editar/ativar bundles |
| **Shopify Function (Rust)** | Aplica o desconto automaticamente no checkout |
| **Theme Extension (Widget)** | Mostra o bundle na pagina do produto com botao "Add Bundle" |
| **Theme Extension (Auto-Add)** | Monitora o carrinho e adiciona/remove o reward automaticamente |
| **Metafields** | Ponte de dados entre admin, storefront e checkout |

---

## 2. Arquitetura

```
┌──────────────────────────────────────────────────────┐
│                    ADMIN (Remix)                      │
│                                                       │
│  /app/bundles/new  →  Cria bundle no SQLite           │
│                    →  Cria DiscountAutomaticApp        │
│                    →  Escreve metafield no produto     │
│                    →  Sincroniza metafield da shop     │
└───────────────┬───────────────────────────────────────┘
                │
       Metafields (JSON)
                │
    ┌───────────┼───────────────┐
    │           │               │
    ▼           ▼               ▼
┌────────┐ ┌──────────┐ ┌───────────────┐
│Shopify │ │  Theme   │ │    Theme       │
│Function│ │  Widget  │ │  Auto-Add      │
│ (Rust) │ │  (PDP)   │ │  (Carrinho)    │
│        │ │          │ │                │
│ Le:    │ │ Le:      │ │ Le:            │
│ discount│ │ product. │ │ shop.          │
│ metafield│ │ metafield│ │ metafield      │
│        │ │          │ │                │
│ Aplica │ │ Mostra   │ │ Adiciona/      │
│desconto│ │ widget + │ │ remove reward  │
│  no    │ │ Add to   │ │ do carrinho    │
│checkout│ │ Cart     │ │ automaticamente│
└────────┘ └──────────┘ └───────────────┘
```

**Principio fundamental:** O checkout da Shopify **nunca** acessa seu banco de dados. Toda informacao que a Function precisa esta em metafields.

---

## 3. Stack Tecnologica

| Camada | Tecnologia | Porque |
|--------|-----------|--------|
| Framework | Remix (Vite) | Padrao oficial Shopify |
| UI Admin | Polaris 12 | Design system Shopify |
| Banco | SQLite + Prisma | Simples, sem infra extra |
| Auth | Shopify OAuth | Integrado no SDK |
| Checkout | Shopify Functions (Rust/Wasm) | Unica forma aprovada de desconto |
| Storefront | Theme App Extension (Liquid) | Nao requer App Proxy |
| Deploy | Docker | Portavel |

---

## 4. Setup Inicial

### 4.1 Criar o projeto

```bash
npm init @shopify/app@latest
# Escolha: Remix template
# Nome: bxapp
```

### 4.2 Estrutura de pastas resultante

```
bxapp/
├── app/
│   ├── routes/           # Rotas Remix (admin)
│   ├── lib/              # Logica server-side
│   ├── db.server.ts      # Singleton Prisma
│   ├── shopify.server.ts # Config do Shopify SDK
│   └── root.tsx          # HTML shell
├── extensions/
│   ├── bxapp/            # Theme App Extension
│   │   ├── blocks/       # Blocos Liquid
│   │   ├── snippets/     # Snippets reutilizaveis
│   │   └── locales/      # i18n
│   └── bxgy-discount/    # Shopify Function (Rust)
│       ├── src/
│       │   ├── main.rs   # Logica do desconto
│       │   └── run.graphql
│       └── Cargo.toml
├── prisma/
│   └── schema.prisma     # Schema do banco
├── shopify.app.toml      # Config do app
├── shopify.web.toml      # Config do web server
├── vite.config.ts
├── Dockerfile
└── package.json
```

### 4.3 Dependencias principais (package.json)

```json
{
  "dependencies": {
    "@prisma/client": "^6.2.1",
    "@remix-run/node": "^2.16.1",
    "@remix-run/react": "^2.16.1",
    "@remix-run/serve": "^2.16.1",
    "@shopify/app-bridge-react": "^4.1.6",
    "@shopify/polaris": "^12.0.0",
    "@shopify/shopify-app-remix": "^4.1.0",
    "@shopify/shopify-app-session-storage-prisma": "^8.0.0",
    "prisma": "^6.2.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "vite": "^6.2.2"
  },
  "scripts": {
    "build": "remix vite:build",
    "dev": "shopify app dev",
    "start": "remix-serve ./build/server/index.js",
    "docker-start": "npm run setup && npm run start",
    "setup": "prisma generate && prisma migrate deploy",
    "deploy": "shopify app deploy"
  },
  "engines": {
    "node": ">=20.19 <22 || >=22.12"
  }
}
```

---

## 5. Configuracao do App Shopify

### 5.1 shopify.app.toml

```toml
client_id = "SEU_CLIENT_ID"
name = "bxapp"
application_url = "https://seu-dominio.com"
embedded = true

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true

[access_scopes]
scopes = "write_products,write_discounts,read_discounts"

[auth]
redirect_urls = ["https://seu-dominio.com/api/auth"]

[webhooks]
api_version = "2026-04"

  [[webhooks.subscriptions]]
  topics = ["app/uninstalled"]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = ["app/scopes_update"]
  uri = "/webhooks/app/scopes_update"
```

**Scopes necessarios:**
- `write_products` — Para escrever metafields nos produtos
- `write_discounts` — Para criar descontos automaticos
- `read_discounts` — Para ler o ID da Function

### 5.2 shopify.web.toml

```toml
name = "remix"
roles = ["frontend", "backend"]
webhooks_path = "/webhooks/app/uninstalled"

[commands]
predev = "npx prisma generate"
dev = "npx prisma migrate deploy && npm exec remix vite:dev"
```

### 5.3 shopify.server.ts — Configuracao do SDK

```typescript
import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-01";
import db from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  restResources,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: false,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const login = shopify.login;
export const unauthenticated = shopify.unauthenticated;
export const registerWebhooks = shopify.registerWebhooks;
```

### 5.4 vite.config.ts

```typescript
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Detecta ambiente HMR
const host = new URL(
  process.env.HMR_HOST || process.env.SHOPIFY_APP_URL || "http://localhost:3000"
).hostname;

const hmrConfig = host === "localhost"
  ? { protocol: "ws", host: "localhost", port: 64999 }
  : {
      protocol: "wss",
      host: host,
      port: parseInt(process.env.FRONTEND_PORT!) || 8002,
      clientPort: 443,
    };

export default defineConfig({
  server: { port: Number(process.env.PORT || 3000), hmr: hmrConfig },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      },
    }),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    include: ["@shopify/polaris", "@shopify/app-bridge-react"],
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: { external: [/node_modules/] },
  },
});
```

---

## 6. Banco de Dados (Prisma + SQLite)

### 6.1 Schema (prisma/schema.prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:dev.sqlite"
}

// Sessoes OAuth da Shopify
model Session {
  id              String    @id
  shop            String
  state           String
  isOnline        Boolean   @default(false)
  scope           String?
  expires         DateTime?
  accessToken     String
  userId          BigInt?
  firstName       String?
  lastName        String?
  email           String?
  accountOwner    Boolean   @default(false)
  locale          String?
  collaborator    Boolean?  @default(false)
  emailVerified   Boolean?  @default(false)
}

// Bundles BXGY
model Bundle {
  id            Int      @id @default(autoincrement())
  name          String
  buyType       String   // "product" | "collection"
  buyReference  String   // GID do produto ou colecao
  minQuantity   Int
  getProductId  String   // GID do produto reward
  discountType  String   // "percentage" | "fixed"
  discountValue Int
  maxReward     Int
  active        Boolean  @default(true)
  shopId        String
  discountId    String?  // GID do DiscountAutomaticApp
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 6.2 Por que SQLite?

- O checkout da Shopify **nunca** acessa seu banco
- O banco so serve para admin/configuracao
- Toda info do checkout esta em metafields
- Para escalar, basta trocar o provider para PostgreSQL no Prisma

### 6.3 db.server.ts — Singleton

```typescript
import { PrismaClient } from "@prisma/client";

declare global {
  var __db: PrismaClient | undefined;
}

const db = globalThis.__db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__db = db;
}

export default db;
```

---

## 7. Autenticacao e Sessoes

### 7.1 Fluxo OAuth

1. Lojista instala o app → Shopify redireciona para `/auth`
2. SDK troca code por access token
3. Token armazenado na tabela `Session` via Prisma
4. Toda rota `/app/*` chama `authenticate.admin(request)` para validar

### 7.2 Rota de login (app/routes/auth.login/route.tsx)

```typescript
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Page, Card, FormLayout, TextField, Button } from "@shopify/polaris";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const errors = { shop: url.searchParams.get("error") };
  return json({ errors, polarisTranslations: require("@shopify/polaris/locales/en.json") });
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const shop = formData.get("shop");
  // login() redireciona para OAuth da Shopify
  const result = await login(request);
  return result;
};
```

### 7.3 Rota catch-all OAuth (app/routes/auth.$.tsx)

```typescript
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // SDK cuida do fluxo OAuth automaticamente
};
```

---

## 8. Rotas do Admin (Remix)

### 8.1 Layout do App (app/routes/app.tsx)

```typescript
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">Home</a>
        <a href="/app/bundles">Bundles</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}
```

### 8.2 Dashboard — Lista de Bundles (app/routes/app._index.tsx)

**Loader:** busca todos os bundles da loja.

```typescript
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const bundles = await db.bundle.findMany({
    where: { shopId: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return json({ bundles });
};
```

**Action:** trata delete e toggle de bundles.

```typescript
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = Number(formData.get("id"));
    const bundle = await db.bundle.findUnique({ where: { id } });

    // 1. Deletar o desconto na Shopify
    if (bundle?.discountId) {
      await admin.graphql(`
        mutation { discountAutomaticDelete(id: "${bundle.discountId}") {
          userErrors { field message }
        }}
      `);
    }

    // 2. Remover metafield do produto
    if (bundle?.buyType === "product") {
      await removeBundleMetafield(admin, bundle.buyReference);
    }

    // 3. Deletar do banco
    await db.bundle.delete({ where: { id } });

    // 4. Re-sincronizar metafield da shop
    await syncShopBundlesMetafield(admin, session.shop, db);
  }

  if (intent === "toggle") {
    const id = Number(formData.get("id"));
    const bundle = await db.bundle.findUnique({ where: { id } });
    const newActive = !bundle.active;

    await db.bundle.update({
      where: { id },
      data: { active: newActive },
    });

    // Atualizar datas do desconto (ativar/desativar)
    if (bundle?.discountId) {
      await admin.graphql(`
        mutation {
          discountAutomaticAppUpdate(
            id: "${bundle.discountId}",
            automaticAppDiscount: {
              startsAt: "${newActive ? new Date().toISOString() : "2099-01-01T00:00:00Z"}",
              endsAt: ${newActive ? "null" : '"2099-01-02T00:00:00Z"'}
            }
          ) { userErrors { field message } }
        }
      `);
    }

    await syncShopBundlesMetafield(admin, session.shop, db);
  }

  return null;
};
```

**UI:** tabela com bundles, botoes de acao.

```tsx
export default function Index() {
  const { bundles } = useLoaderData();
  const navigate = useNavigate();

  return (
    <Page
      title="BXGY Bundles"
      primaryAction={{ content: "Create bundle", onAction: () => navigate("/app/bundles/new") }}
    >
      {bundles.length === 0 ? (
        <EmptyState heading="No bundles yet" action={{ content: "Create bundle", url: "/app/bundles/new" }}>
          <p>Create your first Buy X Get Y bundle</p>
        </EmptyState>
      ) : (
        <Card>
          <IndexTable
            itemCount={bundles.length}
            headings={[
              { title: "Name" },
              { title: "Buy Condition" },
              { title: "Discount" },
              { title: "Status" },
              { title: "Actions" },
            ]}
          >
            {bundles.map((bundle) => (
              <IndexTable.Row key={bundle.id} id={bundle.id.toString()}>
                {/* ... celulas com dados do bundle ... */}
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      )}
    </Page>
  );
}
```

### 8.3 Formulario de Bundle (app/routes/app.bundles.$id.tsx)

Este e o arquivo mais complexo. Ele lida com criacao e edicao de bundles.

**Loader:** busca o ID da Function e dados do bundle (se editando).

```typescript
export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);

  // Buscar o ID da Function de desconto
  const response = await admin.graphql(`
    query {
      shopifyFunctions(first: 25) {
        nodes { apiType id title }
      }
    }
  `);
  const json = await response.json();
  const functions = json.data?.shopifyFunctions?.nodes || [];
  const discountFunction = functions.find(
    (f) => f.apiType === "product_discounts" && f.title === "bxgy-discount"
  );

  if (params.id === "new") {
    return json({ bundle: null, functionId: discountFunction?.id });
  }

  const bundle = await db.bundle.findUnique({
    where: { id: Number(params.id) },
  });
  return json({ bundle, functionId: discountFunction?.id });
};
```

**Action — Criacao:** cria bundle + desconto automatico + metafields.

```typescript
// Dentro da action, quando params.id === "new":

// 1. Criar bundle no banco
const bundle = await db.bundle.create({
  data: {
    name, buyType, buyReference, minQuantity,
    getProductId, discountType, discountValue, maxReward,
    shopId: session.shop,
  },
});

// 2. Montar configuracao para a Function
const functionConfig = JSON.stringify({
  buyType,
  buyProductId: buyType === "product"
    ? buyReference.replace("gid://shopify/Product/", "")
    : "",
  buyCollectionIds: buyType === "collection" ? [buyReference] : [],
  minQuantity,
  getProductId: getProductId.replace("gid://shopify/Product/", ""),
  discountType,
  discountValue,
  maxReward,
});

// 3. Criar desconto automatico na Shopify
const discountResponse = await admin.graphql(`
  mutation CreateDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message }
    }
  }
`, {
  variables: {
    discount: {
      title: name,
      functionId: functionId,
      startsAt: new Date().toISOString(),
      metafields: [{
        namespace: "$app:bxgy-discount",
        key: "function-configuration",
        type: "json",
        value: functionConfig,
      }],
    },
  },
});

// 4. Escrever metafield no buy product (para o widget no tema)
await setBundleMetafield(admin, {
  buyProductId: buyReference,
  bundleName: name,
  minQuantity,
  rewardProductId: getProductId,
  discountType,
  discountValue,
  maxReward,
});

// 5. Sincronizar metafield da shop (para o auto-add)
await syncShopBundlesMetafield(admin, session.shop, db);
```

**UI do formulario:**

```tsx
export default function BundleForm() {
  const { bundle, functionId } = useLoaderData();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const actionData = useActionData();

  // State local para todos os campos
  const [name, setName] = useState(bundle?.name || "");
  const [buyType, setBuyType] = useState(bundle?.buyType || "product");
  const [buyReference, setBuyReference] = useState(bundle?.buyReference || "");
  const [buyLabel, setBuyLabel] = useState("");
  const [minQuantity, setMinQuantity] = useState(bundle?.minQuantity?.toString() || "2");
  const [getProductId, setGetProductId] = useState(bundle?.getProductId || "");
  const [getLabel, setGetLabel] = useState("");
  const [discountType, setDiscountType] = useState(bundle?.discountType || "percentage");
  const [discountValue, setDiscountValue] = useState(bundle?.discountValue?.toString() || "");
  const [maxReward, setMaxReward] = useState(bundle?.maxReward?.toString() || "1");

  // Abrir Resource Picker da Shopify para selecionar produto
  async function pickProduct(field) {
    const selected = await shopify.resourcePicker({ type: "product" });
    if (selected?.length) {
      const product = selected[0];
      if (field === "buy") {
        setBuyReference(product.id);
        setBuyLabel(product.title);
      } else {
        setGetProductId(product.id);
        setGetLabel(product.title);
      }
    }
  }

  function handleSubmit() {
    // Validacao client-side
    if (!name || !buyReference || !getProductId || !discountValue) {
      // mostrar erros
      return;
    }
    submit({
      name, buyType, buyReference, minQuantity,
      getProductId, discountType, discountValue, maxReward,
    }, { method: "post" });
  }

  return (
    <Page title={bundle ? "Edit Bundle" : "Create Bundle"} backAction={{ url: "/app" }}>
      <BlockStack gap="400">
        <Card>
          <FormLayout>
            <TextField label="Bundle name" value={name} onChange={setName} />

            <Select label="Buy type" options={[
              { label: "Product", value: "product" },
              { label: "Collection", value: "collection" },
            ]} value={buyType} onChange={setBuyType} />

            <Button onClick={() => pickProduct("buy")}>
              {buyLabel || "Select buy product"}
            </Button>

            <TextField label="Minimum quantity" type="number"
              value={minQuantity} onChange={setMinQuantity} />

            <Button onClick={() => pickProduct("reward")}>
              {getLabel || "Select reward product"}
            </Button>

            <Select label="Discount type" options={[
              { label: "Percentage", value: "percentage" },
              { label: "Fixed amount", value: "fixed" },
            ]} value={discountType} onChange={setDiscountType} />

            <TextField label="Discount value" type="number"
              value={discountValue} onChange={setDiscountValue}
              suffix={discountType === "percentage" ? "%" : "$"} />

            <TextField label="Max reward items" type="number"
              value={maxReward} onChange={setMaxReward} />
          </FormLayout>
        </Card>

        <Button variant="primary" onClick={handleSubmit}>
          {bundle ? "Update" : "Create"} Bundle
        </Button>
      </BlockStack>
    </Page>
  );
}
```

---

## 9. Gerenciamento de Metafields

Os metafields sao a **ponte** entre o admin, o storefront e o checkout. Existem dois niveis:

### 9.1 Metafield do Produto (widget PDP)

**Namespace:** `bxgy_bundle`
**Key:** `config`
**Owner:** Produto "buy"

```json
{
  "bundleName": "Summer Bundle",
  "minQuantity": 2,
  "discountType": "percentage",
  "discountValue": 50,
  "maxReward": 1,
  "rewardProductTitle": "Beach Hat",
  "rewardProductHandle": "beach-hat",
  "rewardVariantId": "12345678",
  "rewardProductPrice": 2999,
  "rewardProductImage": "https://cdn.shopify.com/..."
}
```

### 9.2 Metafield da Shop (auto-add no carrinho)

**Namespace:** `bxgy_bundle`
**Key:** `active_bundles`
**Owner:** Shop

```json
[
  {
    "buyType": "product",
    "buyProductId": "87654321",
    "buyVariantIds": ["11111", "22222"],
    "minQuantity": 2,
    "rewardVariantId": "33333",
    "maxReward": 1
  }
]
```

### 9.3 Metafield do Desconto (Shopify Function)

**Namespace:** `$app:bxgy-discount`
**Key:** `function-configuration`
**Owner:** DiscountAutomaticApp

```json
{
  "buyType": "product",
  "buyProductId": "87654321",
  "buyCollectionIds": [],
  "minQuantity": 2,
  "getProductId": "12345678",
  "discountType": "percentage",
  "discountValue": 50,
  "maxReward": 1
}
```

### 9.4 Codigo: setBundleMetafield

```typescript
// app/lib/bundle-metafields.server.ts

export async function setBundleMetafield(admin, {
  buyProductId, bundleName, minQuantity,
  rewardProductId, discountType, discountValue, maxReward,
}) {
  // Buscar dados do reward product (titulo, handle, variante, imagem)
  const productResponse = await admin.graphql(`
    query getProduct($id: ID!) {
      product(id: $id) {
        title
        handle
        featuredImage { url }
        variants(first: 1) {
          edges { node { id price } }
        }
      }
    }
  `, { variables: { id: rewardProductId } });

  const productJson = await productResponse.json();
  const rewardProduct = productJson.data?.product;

  // Extrair ID numerico da variante (Cart AJAX API precisa de numeros)
  const rewardVariantGid = rewardProduct?.variants?.edges?.[0]?.node?.id || "";
  const rewardVariantNumericId = rewardVariantGid.replace(
    "gid://shopify/ProductVariant/", ""
  );

  // Preco em centavos
  const rewardPriceCents = rewardProduct?.variants?.edges?.[0]?.node?.price
    ? Math.round(parseFloat(rewardProduct.variants.edges[0].node.price) * 100)
    : 0;

  const metafieldValue = JSON.stringify({
    bundleName,
    minQuantity,
    discountType,
    discountValue,
    maxReward,
    rewardProductTitle: rewardProduct?.title || "reward product",
    rewardProductHandle: rewardProduct?.handle || "",
    rewardVariantId: rewardVariantNumericId,
    rewardProductPrice: rewardPriceCents,
    rewardProductImage: rewardProduct?.featuredImage?.url || "",
  });

  // Escrever no produto via GraphQL
  await admin.graphql(`
    mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        ownerId: buyProductId,
        namespace: "bxgy_bundle",
        key: "config",
        type: "json",
        value: metafieldValue,
      }],
    },
  });
}
```

### 9.5 Codigo: syncShopBundlesMetafield

```typescript
export async function syncShopBundlesMetafield(admin, shopId, db) {
  const bundles = await db.bundle.findMany({
    where: { shopId, active: true },
  });

  const bundleConfigs = [];
  for (const bundle of bundles) {
    // Buscar variant IDs do reward e do buy product
    const [rewardRes, buyRes] = await Promise.all([
      admin.graphql(`
        query getProductVariants($id: ID!) {
          product(id: $id) {
            variants(first: 1) { edges { node { id } } }
          }
        }
      `, { variables: { id: bundle.getProductId } }),

      bundle.buyType === "product"
        ? admin.graphql(`
            query getProductVariants($id: ID!) {
              product(id: $id) {
                variants(first: 100) { edges { node { id } } }
              }
            }
          `, { variables: { id: bundle.buyReference } })
        : Promise.resolve(null),
    ]);

    const rewardJson = await rewardRes.json();
    const rewardVariantId = rewardJson.data?.product?.variants?.edges?.[0]?.node?.id || "";

    let buyVariantIds = [];
    if (buyRes) {
      const buyJson = await buyRes.json();
      buyVariantIds = (buyJson.data?.product?.variants?.edges || [])
        .map((e) => e.node.id);
    }

    // Converter GIDs para IDs numericos
    bundleConfigs.push({
      buyType: bundle.buyType,
      buyProductId: bundle.buyReference.replace("gid://shopify/Product/", ""),
      buyVariantIds: buyVariantIds.map((id) =>
        id.replace("gid://shopify/ProductVariant/", "")
      ),
      minQuantity: bundle.minQuantity,
      rewardVariantId: rewardVariantId.replace("gid://shopify/ProductVariant/", ""),
      maxReward: bundle.maxReward,
    });
  }

  // Buscar GID da shop
  const shopRes = await admin.graphql(`query { shop { id } }`);
  const shopJson = await shopRes.json();
  const shopGid = shopJson.data?.shop?.id;

  // Escrever metafield na shop
  await admin.graphql(`
    mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        ownerId: shopGid,
        namespace: "bxgy_bundle",
        key: "active_bundles",
        type: "json",
        value: JSON.stringify(bundleConfigs),
      }],
    },
  });
}
```

---

## 10. Shopify Function — Desconto em Rust

A Shopify Function e um programa WebAssembly que roda **dentro do checkout da Shopify**. Ela nao tem acesso a rede, banco de dados ou filesystem. Toda informacao vem via GraphQL input.

### 10.1 Criar a extension

```bash
shopify app generate extension --type product_discounts --name bxgy-discount --template rust
```

### 10.2 Cargo.toml

```toml
[package]
name = "bxgy-discount"
version = "0.1.0"
edition = "2021"

[dependencies]
shopify_function = "2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
lto = true
opt-level = 's'
strip = "debuginfo"
```

### 10.3 Input GraphQL (src/run.graphql)

Define quais dados a Function recebe do checkout:

```graphql
query RunInput {
  cart {
    lines {
      id
      quantity
      merchandise {
        ... on ProductVariant {
          id
          product {
            id
          }
        }
      }
    }
  }
  discountNode {
    metafield(namespace: "$app:bxgy-discount", key: "function-configuration") {
      value
    }
  }
}
```

### 10.4 Logica principal (src/main.rs)

```rust
use shopify_function::prelude::*;
use shopify_function::Result;
use serde::Deserialize;

// Configuracao lida do metafield
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FunctionConfig {
    buy_type: String,
    buy_product_id: String,
    buy_collection_ids: Vec<String>,
    min_quantity: i64,
    get_product_id: String,
    discount_type: String,
    discount_value: f64,
    max_reward: i64,
}

// Gera os tipos Rust a partir do GraphQL
generate_types!(
    query_path = "./src/run.graphql",
    schema_path = "./schema.graphql"
);

#[shopify_function_target(query_path = "src/run.graphql", schema_path = "schema.graphql")]
fn run(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    let empty = output::FunctionRunResult { discounts: vec![] };

    // 1. Ler configuracao do metafield
    let config_str = match &input.discount_node.metafield {
        Some(m) => &m.value,
        None => return Ok(empty),
    };
    let config: FunctionConfig = serde_json::from_str(config_str).unwrap_or_default();

    if config.min_quantity == 0 || config.get_product_id.is_empty() {
        return Ok(empty);
    }

    let get_product_gid = format!("gid://shopify/Product/{}", config.get_product_id);

    // 2. Contar quantidade "buy" no carrinho
    let mut buy_qty: i64 = 0;
    let mut reward_targets: Vec<output::Target> = vec![];

    for line in &input.cart.lines {
        let quantity = line.quantity;
        if let input::InputCartLinesMerchandise::ProductVariant(variant) = &line.merchandise {
            let product_id = &variant.product.id;
            let product_id_numeric = product_id
                .replace("gid://shopify/Product/", "");

            // Verificar se e um produto "buy"
            let is_buy = match config.buy_type.as_str() {
                "product" => product_id_numeric == config.buy_product_id,
                "collection" => {
                    // Para colecoes, precisa de query GraphQL expandida
                    false
                },
                _ => false,
            };

            if is_buy && *product_id != get_product_gid {
                buy_qty += quantity;
            }

            // Verificar se e o produto reward
            if *product_id == get_product_gid {
                reward_targets.push(output::Target::ProductVariant(
                    output::ProductVariantTarget {
                        id: variant.id.clone(),
                        quantity: Some(quantity),
                    },
                ));
            }
        }
    }

    // 3. Verificar se condicao e atendida
    if buy_qty < config.min_quantity || reward_targets.is_empty() {
        return Ok(empty);
    }

    // 4. Limitar quantidade do reward
    let allowed_reward = std::cmp::min(
        reward_targets.iter().map(|t| match t {
            output::Target::ProductVariant(pv) => pv.quantity.unwrap_or(0),
        }).sum::<i64>(),
        config.max_reward,
    );

    // Ajustar targets para o limite
    let mut remaining = allowed_reward;
    let limited_targets: Vec<output::Target> = reward_targets.into_iter().filter_map(|t| {
        if remaining <= 0 { return None; }
        match t {
            output::Target::ProductVariant(pv) => {
                let qty = std::cmp::min(pv.quantity.unwrap_or(0), remaining);
                remaining -= qty;
                Some(output::Target::ProductVariant(output::ProductVariantTarget {
                    id: pv.id,
                    quantity: Some(qty),
                }))
            }
        }
    }).collect();

    // 5. Montar desconto
    let value = match config.discount_type.as_str() {
        "percentage" => output::Value::Percentage(output::Percentage {
            value: config.discount_value.to_string(),
        }),
        "fixed" => output::Value::FixedAmount(output::FixedAmount {
            amount: config.discount_value.to_string(),
        }),
        _ => return Ok(empty),
    };

    Ok(output::FunctionRunResult {
        discounts: vec![output::Discount {
            targets: limited_targets,
            value,
            message: Some("BXGY Bundle Discount".to_string()),
        }],
    })
}
```

### 10.5 Regras da Function

- Roda **a cada mudanca no carrinho** (nao so no checkout)
- Nao tem estado — e **pura funcao**
- Nao tem acesso a rede
- Toda regra deve ser **deterministico**
- Tempo maximo de execucao: ~5ms
- Tamanho maximo do Wasm: 256KB

### 10.6 Configuracao da extension (shopify.extension.toml)

```toml
api_version = "2025-01"

[[extensions]]
name = "bxgy-discount"
handle = "bxgy-discount"
type = "function"

  [extensions.build]
  command = "cargo wasi build --release"
  path = "target/wasm32-wasip1/release/bxgy-discount.wasm"

  [extensions.targeting]
    target = "purchase.product-discount.run"
    input_query = "src/run.graphql"

  [extensions.ui]
    enable_create = false
```

---

## 11. Theme Extension — Widget Interativo

Este e o widget que aparece na pagina do produto (PDP), mostrando os dois produtos do bundle lado a lado com botao "Add Bundle to Cart".

### 11.1 Criar a extension

```bash
shopify app generate extension --type theme_app_extension --name bxapp
```

### 11.2 Visao do widget

```
+----------------------------------------------------------+
|  [Star] BUNDLE DEAL                                      |
|                                                          |
|  +------------------+   +   +------------------+        |
|  |  [Buy Product    |       |  [Reward Product |        |
|  |   Image]         |       |   Image]         |        |
|  |  Product Title   |       |  Product Title    |        |
|  |  $XX.XX          |       |  ~$XX.XX~ $YY.YY |        |
|  |  Qty: 2          |       |  [Variant Select] |        |
|  +------------------+       +-------------------+        |
|                                                          |
|  ~$XX.XX~  $YY.YY  (You save $ZZ.ZZ)                    |
|  [========= Add Bundle to Cart =========]                |
|  Discount applied automatically at checkout              |
+----------------------------------------------------------+
```

### 11.3 Estrutura do bloco (blocks/bundle_promo.liquid)

O arquivo Liquid e dividido em 4 partes:

1. **Liquid** — Extrai dados do metafield + produto
2. **CSS** — Estilos com BEM (`bxgy-widget__*`)
3. **HTML** — Estrutura do widget
4. **JavaScript** — Interatividade (variante, cart, precos)

### 11.4 Parte 1: Liquid — Extracao de dados

```liquid
{% assign bundle_data = product.metafields.bxgy_bundle.config.value %}

{% if bundle_data != blank %}
  {% assign discount_type = bundle_data.discountType %}
  {% assign discount_value = bundle_data.discountValue %}
  {% assign min_quantity = bundle_data.minQuantity %}
  {% assign reward_product_title = bundle_data.rewardProductTitle %}
  {% assign max_reward = bundle_data.maxReward %}
  {% assign reward_product_handle = bundle_data.rewardProductHandle %}
  {% assign reward_variant_id = bundle_data.rewardVariantId %}
  {% assign reward_product_price = bundle_data.rewardProductPrice %}
  {% assign reward_product_image = bundle_data.rewardProductImage %}

  {%- comment -%} Tentar dados live do reward product {%- endcomment -%}
  {% assign reward_product = all_products[reward_product_handle] %}

  {%- comment -%} Imagem: live > metafield fallback {%- endcomment -%}
  {% if reward_product != blank and reward_product.featured_image != blank %}
    {% assign rw_image = reward_product.featured_image | image_url: width: 300 %}
  {% elsif reward_product_image != blank %}
    {% assign rw_image = reward_product_image %}
  {% endif %}

  {%- comment -%} Preco: live > metafield fallback (em centavos) {%- endcomment -%}
  {% if reward_product != blank %}
    {% assign rw_price = reward_product.price %}
  {% elsif reward_product_price != blank %}
    {% assign rw_price = reward_product_price %}
  {% else %}
    {% assign rw_price = 0 %}
  {% endif %}

  {%- comment -%} Calculo do preco com desconto {%- endcomment -%}
  {% if discount_type == "percentage" %}
    {% assign discount_fraction = discount_value | times: 100 | divided_by: 10000.0 %}
    {% assign rw_discounted = rw_price | times: 1.0 | times: discount_fraction %}
    {% assign rw_discounted = rw_price | minus: rw_discounted | round %}
  {% else %}
    {% assign discount_cents = discount_value | times: 100 %}
    {% assign rw_discounted = rw_price | minus: discount_cents %}
    {% if rw_discounted < 0 %}{% assign rw_discounted = 0 %}{% endif %}
  {% endif %}

  {%- comment -%} Disponibilidade do reward {%- endcomment -%}
  {% assign reward_available = true %}
  {% if reward_product != blank %}
    {% assign reward_available = reward_product.available %}
  {% endif %}
```

**Conceitos-chave:**
- `all_products[handle]` — Acessa dados live de qualquer produto pelo handle
- Fallback para dados do metafield caso `all_products` falhe (limite de 20 lookups)
- Precos em Liquid sao em **centavos** (ex: $29.99 = 2999)

### 11.5 Parte 2: CSS — Estilos responsivos

```html
<style>
  .bxgy-widget {
    border: 2px solid {{ block.settings.border_color }};
    border-radius: 12px;
    padding: 20px;
    margin: 16px 0;
    background: {{ block.settings.background_color }};
    font-family: inherit; /* Herda fonte do tema */
  }

  .bxgy-widget__products {
    display: flex;
    align-items: stretch;
    margin-bottom: 16px;
  }

  .bxgy-widget__product-card {
    flex: 1;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .bxgy-widget__product-image {
    width: 100%;
    max-width: 120px;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 8px;
  }

  .bxgy-widget__plus {
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 24px;
    font-weight: 700;
    color: {{ block.settings.accent_color }};
  }

  /* Botao customizavel via settings */
  .bxgy-widget__add-btn {
    width: 100%;
    padding: 14px;
    font-size: 16px;
    font-weight: 700;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    background: {{ block.settings.button_color }};
    color: {{ block.settings.button_text_color }};
  }

  /* Loading spinner no botao */
  .bxgy-widget__add-btn--loading {
    color: transparent !important;
  }
  .bxgy-widget__add-btn--loading::after {
    content: '';
    position: absolute;
    /* ... spinner CSS ... */
    animation: bxgy-spin 0.7s linear infinite;
  }

  /* Mobile: empilhar cards */
  @media (max-width: 749px) {
    .bxgy-widget__products {
      flex-direction: column;
      align-items: center;
    }
    .bxgy-widget__plus {
      transform: rotate(90deg);
    }
  }
</style>
```

**Principios:**
- Prefixo `bxgy-widget__` em todas as classes (BEM) para evitar conflito com temas
- `font-family: inherit` — respeita a fonte do tema
- Cores configuraveis via `block.settings` (customizavel no Theme Editor)
- Responsivo: side-by-side no desktop, stacked no mobile (749px = breakpoint Dawn)

### 11.6 Parte 3: HTML — Estrutura do widget

```liquid
<div class="bxgy-widget" id="bxgy-widget-{{ block.id }}">
  <!-- Badge -->
  <div class="bxgy-widget__badge">
    <svg><!-- star icon --></svg>
    <span>{{ block.settings.badge_text }}</span>
  </div>

  <!-- Product Cards -->
  <div class="bxgy-widget__products">
    <!-- Buy Product -->
    <div class="bxgy-widget__product-card">
      <div class="bxgy-widget__product-label">Buy</div>
      <img src="{{ buy_image }}" alt="{{ buy_title | escape }}">
      <div class="bxgy-widget__product-title">{{ buy_title }}</div>
      <div class="bxgy-widget__product-price" data-bxgy-buy-price>
        {{ buy_price | money }}
      </div>
      <div class="bxgy-widget__product-qty">Qty: {{ min_quantity }}</div>
    </div>

    <div class="bxgy-widget__plus">+</div>

    <!-- Reward Product -->
    <div class="bxgy-widget__product-card">
      <div class="bxgy-widget__product-label--reward">Get {{ discount_label }}</div>
      <img src="{{ rw_image }}" data-bxgy-reward-image>
      <div class="bxgy-widget__product-title">{{ reward_product_title }}</div>
      <div data-bxgy-reward-price>
        <span class="bxgy-widget__product-price--original">{{ rw_price | money }}</span>
        <span class="bxgy-widget__product-price--discounted">{{ rw_discounted | money }}</span>
      </div>

      <!-- Seletor de variante do reward (se multi-variant) -->
      {% if reward_product != blank and reward_product.variants.size > 1 %}
        <select data-bxgy-reward-variant-select>
          {% for variant in reward_product.variants %}
            {% if variant.available %}
              <option value="{{ variant.id }}" data-price="{{ variant.price }}">
                {{ variant.title }} - {{ variant.price | money }}
              </option>
            {% endif %}
          {% endfor %}
        </select>
      {% endif %}
    </div>
  </div>

  <!-- Resumo de precos -->
  <div class="bxgy-widget__summary">
    <span data-bxgy-total-original></span>
    <span data-bxgy-total-final></span>
    <div data-bxgy-savings></div>
  </div>

  <!-- Botao Add Bundle -->
  <button data-bxgy-add-btn {% unless reward_available %}disabled{% endunless %}>
    {% if reward_available %}Add Bundle to Cart{% else %}Reward Product Unavailable{% endif %}
  </button>

  <!-- Feedback -->
  <div class="bxgy-widget__feedback" data-bxgy-feedback></div>
  <div class="bxgy-widget__footer">Discount applied automatically at checkout</div>
</div>
```

### 11.7 Parte 4: JavaScript — Interatividade

```html
<script>
(function() {
  var widget = document.getElementById('bxgy-widget-{{ block.id }}');
  if (!widget) return;

  /* ── Config do Liquid (injetado como JSON) ── */
  var config = {
    discountType: {{ discount_type | json }},
    discountValue: {{ discount_value | json }},
    minQuantity: {{ min_quantity | json }},
    fallbackRewardVariantId: {{ reward_variant_id | json }},
    shopMoneyFormat: {{ shop.money_format | json }}
  };

  /* ── Lookup de variantes do buy product ── */
  var buyVariants = {};
  {% for variant in product.variants %}
    buyVariants['{{ variant.id }}'] = {
      price: {{ variant.price }},
      available: {{ variant.available | json }}
    };
  {% endfor %}

  /* ── Detectar variante selecionada na PDP ── */
  function detectBuyVariant() {
    // 1. URL param (mais universal)
    var urlVariant = new URLSearchParams(window.location.search).get('variant');
    if (urlVariant && buyVariants[urlVariant]) return urlVariant;

    // 2. Hidden input no form
    var input = document.querySelector('form[action*="/cart/add"] input[name="id"]');
    if (input && buyVariants[input.value]) return input.value;

    // 3. Select element
    var select = document.querySelector('form[action*="/cart/add"] select[name="id"]');
    if (select && buyVariants[select.value]) return select.value;

    // 4. Primeira variante disponivel
    return Object.keys(buyVariants).find(k => buyVariants[k].available);
  }

  /* ── Listeners para mudanca de variante ── */

  // URL change (popstate)
  window.addEventListener('popstate', checkUrlVariant);

  // Evento customizado de temas (ex: Dawn)
  document.addEventListener('variant:changed', function(e) {
    if (e.detail?.variant?.id) onBuyVariantChange(String(e.detail.variant.id));
  });

  // MutationObserver no input hidden (temas que mudam o value)
  var variantInput = document.querySelector('form[action*="/cart/add"] input[name="id"]');
  if (variantInput) {
    new MutationObserver(function() {
      onBuyVariantChange(variantInput.value);
    }).observe(variantInput, { attributes: true, attributeFilter: ['value'] });
  }

  // Polling de URL (para pushState que nao dispara popstate)
  var lastUrl = window.location.href;
  setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      checkUrlVariant();
    }
  }, 500);

  /* ── Add Bundle to Cart ── */
  addBtn.addEventListener('click', function() {
    var buyVid = currentBuyVariantId || detectBuyVariant();
    var rewardVid = currentRewardVariantId || config.fallbackRewardVariantId;

    var items = [
      { id: Number(buyVid), quantity: config.minQuantity },
      { id: Number(rewardVid), quantity: 1, properties: { '_bxgy_reward': 'true' } }
    ];

    fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    })
    .then(function(response) {
      if (!response.ok) throw new Error('Failed to add');
      showFeedback('success', 'Bundle added to cart!');
    })
    .catch(function(err) {
      showFeedback('error', err.message);
    });
  });
})();
</script>
```

**Detalhe crucial:** A property `_bxgy_reward: 'true'` no reward item e consistente com o `bundle_auto_add.liquid`. Isso permite que o auto-add saiba que o reward ja foi adicionado manualmente.

### 11.8 Schema do bloco

```json
{% schema %}
{
  "name": "BXGY Bundle Promo",
  "target": "section",
  "settings": [
    { "type": "text", "id": "badge_text", "label": "Badge text", "default": "Bundle Deal" },
    { "type": "text", "id": "preview_discount", "label": "Fallback discount text", "default": "50% off" },
    { "type": "text", "id": "preview_min_qty", "label": "Fallback min quantity", "default": "2" },
    { "type": "text", "id": "preview_reward", "label": "Fallback reward product name", "default": "a free gift" },
    { "type": "color", "id": "accent_color", "label": "Accent color", "default": "#e85d04" },
    { "type": "color", "id": "background_color", "label": "Background color", "default": "#fff8f0" },
    { "type": "color", "id": "border_color", "label": "Border color", "default": "#e85d04" },
    { "type": "color", "id": "text_color", "label": "Text color", "default": "#1a1a1a" },
    { "type": "color", "id": "button_color", "label": "Button color", "default": "#e85d04" },
    { "type": "color", "id": "button_text_color", "label": "Button text color", "default": "#ffffff" }
  ]
}
{% endschema %}
```

**`target: "section"`** — O bloco e adicionado dentro de uma section (ex: produto) no Theme Editor. O lojista arrasta o bloco para onde quiser na PDP.

---

## 12. Theme Extension — Auto-Add no Carrinho

Este bloco monitora o carrinho e adiciona/remove o reward automaticamente quando as condicoes do bundle sao atendidas.

### 12.1 blocks/bundle_auto_add.liquid

```liquid
{% assign bundles_data = shop.metafields.bxgy_bundle.active_bundles.value %}

{% if bundles_data != blank %}
<script>
(function() {
  var BUNDLES = {{ shop.metafields.bxgy_bundle.active_bundles.value | json }};
  if (!BUNDLES || !Array.isArray(BUNDLES) || !BUNDLES.length) return;

  var DEBOUNCE_MS = 800;
  var processing = false;
  var timer = null;

  function getCart() {
    return fetch('/cart.js', { credentials: 'same-origin' }).then(r => r.json());
  }

  function addToCart(variantId, quantity) {
    return fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: Number(variantId), quantity, properties: { '_bxgy_reward': 'true' } }]
      })
    }).then(r => r.json());
  }

  function checkAndUpdateCart() {
    if (processing) return;
    processing = true;

    getCart().then(function(cart) {
      var items = cart.items || [];
      var chain = Promise.resolve();
      var changed = false;

      BUNDLES.forEach(function(bundle) {
        // Contar quantidade "buy" no carrinho
        var buyQty = 0;
        items.forEach(function(item) {
          if (bundle.buyType === 'product') {
            var matchesProduct = String(item.product_id) === String(bundle.buyProductId);
            var matchesVariant = bundle.buyVariantIds?.indexOf(String(item.variant_id)) !== -1;
            // Nao contar o reward como buy
            if ((matchesProduct || matchesVariant) &&
                String(item.variant_id) !== String(bundle.rewardVariantId)) {
              buyQty += item.quantity;
            }
          }
        });

        // Verificar se reward ja esta no carrinho
        var rewardItem = items.find(i => String(i.variant_id) === String(bundle.rewardVariantId));

        if (buyQty >= bundle.minQuantity && !rewardItem) {
          changed = true;
          chain = chain.then(() => addToCart(bundle.rewardVariantId, 1));
        } else if (buyQty < bundle.minQuantity && rewardItem) {
          changed = true;
          chain = chain.then(() => changeCartItem(rewardItem.key, 0));
        }
      });

      return chain.then(() => changed);
    }).then(function(changed) {
      if (changed) window.location.reload();
    }).finally(function() {
      processing = false;
    });
  }

  // Verificar no carregamento da pagina
  setTimeout(checkAndUpdateCart, 300);

  // Interceptar fetch para detectar mudancas no carrinho
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = typeof arguments[0] === 'string' ? arguments[0] : '';
    var isCartMutation = /\/cart\/(add|change|update|clear)/.test(url);
    var body = arguments[1]?.body || '';
    var isOurCall = typeof body === 'string' && body.indexOf('_bxgy_reward') !== -1;

    var result = origFetch.apply(this, arguments);

    if (isCartMutation && !isOurCall) {
      result.then(function() {
        clearTimeout(timer);
        timer = setTimeout(checkAndUpdateCart, DEBOUNCE_MS);
      });
    }
    return result;
  };
})();
</script>
{% endif %}

{% schema %}
{
  "name": "BXGY Auto-Add Reward",
  "target": "body",
  "settings": []
}
{% endschema %}
```

**`target: "body"`** — Este bloco e injetado no body de todas as paginas, nao apenas PDP. Assim ele funciona tambem na pagina do carrinho.

**Mecanismos anti-loop:**
- Flag `processing` impede execucoes paralelas
- Verifica `_bxgy_reward` no body do fetch para nao interceptar suas proprias chamadas
- Debounce de 800ms entre verificacoes

---

## 13. Webhooks

### 13.1 App Uninstalled

```typescript
// app/routes/webhooks.app.uninstalled.tsx
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);

  // Limpar tudo do lojista
  await db.session.deleteMany({ where: { shop } });
  await db.bundle.deleteMany({ where: { shopId: shop } });

  return new Response(null, { status: 200 });
};
```

### 13.2 Scopes Update

```typescript
// app/routes/webhooks.app.scopes_update.tsx
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.webhook(request);

  // Atualizar scopes na sessao
  await db.session.update({
    where: { id: session.id },
    data: { scope: session.scope },
  });

  return new Response(null, { status: 200 });
};
```

---

## 14. Deploy e Docker

### 14.1 Dockerfile

```dockerfile
FROM node:18-alpine

RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Instalar deps (sem devDependencies)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN npm remove @shopify/cli

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
```

### 14.2 Fluxo de deploy

```bash
# 1. Build e deploy das extensions
shopify app deploy

# 2. Build Docker
docker build -t bxapp .

# 3. Run (ou push para host de sua escolha)
docker run -p 3000:3000 \
  -e SHOPIFY_API_KEY=xxx \
  -e SHOPIFY_API_SECRET=xxx \
  -e SHOPIFY_APP_URL=https://seu-dominio.com \
  bxapp
```

### 14.3 Opcoes de hosting

| Servico | Custo | Observacao |
|---------|-------|-----------|
| Fly.io | ~$5/mes | Bom para MVPs |
| Railway | ~$5/mes | Deploy facil |
| Render | Free tier | Pode dormir |
| AWS ECS | Variavel | Para producao seria |
| DigitalOcean App Platform | ~$5/mes | Simples |

---

## 15. Edge Cases e Tratamento de Erros

| Caso | Onde | Tratamento |
|------|------|-----------|
| Reward fora de estoque | Widget (Liquid) | `reward_product.available` desabilita botao |
| Variante do reward sem estoque | Widget (Liquid) | So renderiza variantes com `variant.available` |
| Mesmo produto como buy e reward | Cart API | Line items separados por `properties` diferentes |
| `all_products` retorna vazio | Widget (Liquid) | Fallback para dados do metafield |
| Erro no `/cart/add.js` | Widget (JS) | Mostra mensagem de erro no widget |
| Lojista desinstala o app | Webhook | Limpa sessoes e bundles do banco |
| Metafield nao existe | Function (Rust) | Retorna `discounts: []` (sem desconto) |
| Function configuration invalida | Function (Rust) | `serde_json::from_str` retorna default, sem desconto |
| Multiple bundles no mesmo produto | Auto-add | Itera todos os bundles, aplica cada um |
| Reward adicionado manualmente e via auto-add | Auto-add | Verifica se reward ja esta no carrinho antes de adicionar |

---

## 16. Checklist de Aprovacao na Shopify App Store

### Obrigatorios

- [x] Desconto aplicado via Shopify Function (nao via Draft Orders ou scripts)
- [x] Sem App Proxy necessario
- [x] Theme Extension (nao ScriptTag injetado)
- [x] Webhooks tratados (app/uninstalled obrigatorio)
- [x] OAuth completo com session storage
- [x] Scopes minimos necessarios
- [x] GDPR endpoints (obrigatorio para apps publicos — adicionar)
- [x] UX clara no admin

### Recomendados

- [ ] Politica de privacidade
- [ ] Documentacao para o lojista
- [ ] Onboarding guided
- [ ] Testes automatizados
- [ ] Rate limiting

### GDPR (obrigatorio para app store)

Adicionar rotas para:
- `POST /webhooks/customers/data_request`
- `POST /webhooks/customers/redact`
- `POST /webhooks/shop/redact`

---

## 17. Fluxo Completo de Dados

```
CRIACAO DO BUNDLE:
═══════════════════
Lojista → /app/bundles/new → Preenche form
  │
  ├─→ db.bundle.create()              → SQLite
  ├─→ discountAutomaticAppCreate()    → Shopify (cria desconto)
  │     └─→ metafield no desconto     → Function config (JSON)
  ├─→ setBundleMetafield()            → Metafield no buy product
  │     └─→ rewardVariantId, price, image, handle
  └─→ syncShopBundlesMetafield()      → Metafield na shop
        └─→ Array de todos bundles ativos


NA LOJA (STOREFRONT):
═════════════════════
Cliente visita PDP do buy product
  │
  ├─→ bundle_promo.liquid carrega
  │     ├─→ Le product.metafields.bxgy_bundle.config
  │     ├─→ Busca reward via all_products[handle]
  │     ├─→ Renderiza widget com imagens e precos
  │     └─→ JS: botao "Add Bundle to Cart"
  │           └─→ POST /cart/add.js (2 items)
  │
  └─→ bundle_auto_add.liquid (no body)
        ├─→ Le shop.metafields.bxgy_bundle.active_bundles
        ├─→ Monitora cart mutations
        └─→ Adiciona/remove reward automaticamente


NO CHECKOUT:
════════════
Shopify Function (Rust/Wasm) executa
  │
  ├─→ Le metafield do desconto (function-configuration)
  ├─→ Le cart lines do input GraphQL
  ├─→ Conta buy quantity
  ├─→ Identifica reward product
  │
  └─→ Se condicao atendida:
        └─→ Retorna desconto (% ou fixo) no reward product
```

---

## Resumo Final

Um app BXGY completo tem **5 camadas** que se comunicam via metafields:

| # | Camada | Tecnologia | Faz o que |
|---|--------|-----------|-----------|
| 1 | Admin Panel | Remix + Polaris | CRUD de bundles |
| 2 | Banco de Dados | SQLite + Prisma | Persiste configuracao |
| 3 | Shopify Function | Rust → Wasm | Aplica desconto no checkout |
| 4 | Widget PDP | Liquid + CSS + JS | Mostra bundle + Add to Cart |
| 5 | Auto-Add Script | Liquid + JS | Gerencia reward no carrinho |

A **chave da arquitetura** e que o checkout nunca acessa seu servidor. Toda informacao que a Function precisa esta em metafields, escritos pelo admin no momento da criacao/edicao do bundle.
