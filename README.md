# 🎬 TorBox Stremio Addon

Addon para o Stremio que exibe seu catálogo pessoal do **TorBox** (torrents e usenet) com metadados em **Português BR** obtidos do TMDB.

---

## ✨ Funcionalidades

- 📂 **Catálogo de Filmes e Séries** — exibe todo o conteúdo baixado no TorBox
- 🇧🇷 **Metadados em PT-BR** — título, sinopse, pôster e backdrop do TMDB
- 📅 **Ordenação** por data de adição, data de lançamento ou título
- 🔍 **Busca** dentro do catálogo
- ▶️ **Reprodução direta** — ao clicar no título, as versões disponíveis no TorBox aparecem para play no player do Stremio
- ⚡ Suporte a **Torrents e Usenet** do TorBox
- 💾 Cache inteligente para não sobrecarregar as APIs

---

## 🚀 Deploy Rápido

### Opção 1 — Vercel (recomendado, grátis)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SEU_USUARIO/torbox-stremio-addon)

1. Faça um fork/clone deste repositório no GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Clique em **Deploy** (sem variáveis de ambiente — as chaves são configuradas pelo usuário no Stremio)

**URL do addon:** `https://seu-projeto.vercel.app`

---

### Opção 2 — Render (grátis)

1. Faça um fork deste repositório no GitHub
2. Acesse [render.com](https://render.com) → New → Web Service
3. Conecte o repositório
4. Render detecta automaticamente o `render.yaml`
5. Clique em **Create Web Service**

**URL do addon:** `https://seu-projeto.onrender.com`

> ⚠️ No plano gratuito do Render, o serviço hiberna após inatividade. A primeira requisição pode demorar ~30s para acordar.

---

## 🔧 Configuração no Stremio

Após o deploy, instale o addon no Stremio:

1. Abra o Stremio → **Configurações** → **Addons**
2. Cole a URL do addon com `/configure` no final:
   ```
   https://seu-projeto.vercel.app/configure
   ```
3. Na tela de configuração, preencha:
   - **TorBox API Key** — obtenha em [torbox.app/settings/api](https://torbox.app/settings/api)
   - **TMDB API Key (v3)** — obtenha em [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   - **Ordenar por** — escolha entre: Data de Adição, Data de Lançamento, Título
4. Clique em **Instalar**

Ou instale diretamente via URL:
```
stremio://seu-projeto.vercel.app/manifest.json
```

---

## 🛠️ Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Rodar localmente (porta 7860)
npm start

# Ou com hot-reload
npm run dev
```

Acesse `http://localhost:7860` para ver o manifest.  
Para configurar localmente, use: `http://localhost:7860/configure`

---

## 📁 Estrutura do Projeto

```
torbox-stremio-addon/
├── index.js          # Servidor principal + manifest do Stremio
├── src/
│   ├── torbox.js     # Integração com a API do TorBox
│   ├── tmdb.js       # Integração com a API do TMDB (PT-BR)
│   ├── builder.js    # Constrói catálogo, meta e streams
│   └── parser.js     # Parser inteligente de nomes de arquivos
├── vercel.json       # Config para deploy no Vercel
├── render.yaml       # Config para deploy no Render
└── package.json
```

---

## 🔑 APIs Utilizadas

### TorBox API
- `GET /v1/api/torrents/mylist` — lista todos os torrents
- `GET /v1/api/usenet/mylist` — lista todos os usenet
- `GET /v1/api/torrents/requestdl` — gera link de download direto

### TMDB API (PT-BR)
- `GET /search/movie` e `/search/tv` — busca por título
- `GET /movie/{id}` e `/tv/{id}` — metadados completos
- `GET /tv/{id}/season/{n}` — episódios de temporada

---

## ⚙️ Como Funciona

```
Stremio solicita catálogo
       ↓
TorBox API → lista downloads completos
       ↓
Parser → extrai título, ano, temporada/episódio do nome
       ↓
TMDB API → busca metadados em PT-BR (pôster, sinopse, etc.)
       ↓
Catálogo organizado retorna ao Stremio

Usuário clica em um título
       ↓
TorBox API → lista arquivos do download
       ↓
TorBox API → gera link direto para cada arquivo de vídeo
       ↓
Streams aparecem no player do Stremio para reprodução
```

---

## 🐛 Solução de Problemas

**Catálogo vazio:**
- Verifique se as chaves de API estão corretas
- Confirme que há downloads **concluídos** no TorBox
- Verifique os logs do servidor para erros

**Pôsters incorretos:**
- O parser tenta casar o nome do arquivo com o TMDB; nomes muito modificados podem falhar
- O cache de 24h preserva correspondências — reinicie o servidor se precisar reprocessar

**Streams não aparecem:**
- Os links do TorBox expiram; reabra o título para gerar novos
- Verifique se o arquivo é um formato de vídeo suportado

---

## 📄 Licença

MIT
