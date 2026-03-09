# 🎬 TorBox Stremio Addon

> 🇧🇷 [Português](#português) · 🇺🇸 [English](#english)

---

## Português

Addon para o Stremio que exibe seu catálogo pessoal do **TorBox** (torrents e usenet) com metadados em **Português BR** obtidos do TMDB.

### ✨ Funcionalidades

- 📂 **Catálogo de Filmes e Séries** — exibe todo o conteúdo baixado no TorBox
- 🇧🇷 **Metadados em PT-BR** — título, sinopse, pôster e backdrop do TMDB
- 📅 **Ordenação** por data de adição, data de lançamento ou título
- 🔍 **Busca** dentro do catálogo
- ▶️ **Reprodução direta** — ao clicar no título, as versões disponíveis no TorBox aparecem para play no player do Stremio
- ⚡ Suporte a **Torrents e Usenet** do TorBox
- 💾 Cache inteligente para não sobrecarregar as APIs

---

### 🚀 Deploy Rápido

#### Opção 1 — Vercel (recomendado, grátis)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SEU_USUARIO/torbox-stremio-addon)

1. Faça um fork/clone deste repositório no GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Clique em **Deploy** (sem variáveis de ambiente — as chaves são configuradas pelo usuário no Stremio)

**URL do addon:** `https://seu-projeto.vercel.app`

---

#### Opção 2 — Render (grátis)

1. Faça um fork deste repositório no GitHub
2. Acesse [render.com](https://render.com) → New → Web Service
3. Conecte o repositório
4. Render detecta automaticamente o `render.yaml`
5. Clique em **Create Web Service**

**URL do addon:** `https://seu-projeto.onrender.com`

> ⚠️ No plano gratuito do Render, o serviço hiberna após inatividade. A primeira requisição pode demorar ~30s para acordar.

---

### 🔧 Configuração no Stremio

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

### 🛠️ Desenvolvimento Local

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

### 📁 Estrutura do Projeto

```
torbox-stremio-addon/
├── Index.js          # Entry point local (inicia o servidor na porta 7860)
├── app.js            # Configuração Express + rotas do addon Stremio
├── api/
│   └── server.js     # Entry point serverless (Vercel)
├── src/
│   ├── torbox.js     # Integração com a API do TorBox
│   ├── tmdb.js       # Integração com a API do TMDB (PT-BR)
│   ├── builder.js    # Constrói catálogo, meta e streams
│   └── parser.js     # Parser inteligente de nomes de arquivos
├── configure.html    # Página de configuração do addon
├── vercel.json       # Config para deploy no Vercel
└── package.json
```

---

### 🔑 APIs Utilizadas

#### TorBox API
- `GET /v1/api/torrents/mylist` — lista todos os torrents
- `GET /v1/api/usenet/mylist` — lista todos os downloads usenet
- `GET /v1/api/torrents/requestdl` — gera link de download direto

#### TMDB API (PT-BR)
- `GET /search/movie` e `/search/tv` — busca por título
- `GET /movie/{id}` e `/tv/{id}` — metadados completos
- `GET /tv/{id}/season/{n}` — episódios de temporada

---

### ⚙️ Como Funciona

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

### 🐛 Solução de Problemas

**Catálogo vazio:**
- Verifique se as chaves de API estão corretas
- Confirme que há downloads **concluídos** no TorBox
- Verifique os logs do servidor para erros

**Pôsters incorretos:**
- O parser tenta casar o nome do arquivo com o TMDB; nomes muito modificados podem falhar
- O cache de 24h preserva correspondências — reinicie o servidor se precisar reprocessar

**Streams não aparecem:**
- Os links do TorBox expiram; reabra o título para gerar novos
- Verifique se o arquivo é um formato de vídeo suportado (`.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.wmv`, `.webm`)

---

---

## English

A Stremio addon that displays your personal **TorBox** catalog (torrents and usenet) with metadata fetched from TMDB.

### ✨ Features

- 📂 **Movies & Series Catalog** — displays all content downloaded on TorBox
- 🌐 **TMDB Metadata** — title, synopsis, poster, and backdrop
- 📅 **Sorting** by date added, release date, or title
- 🔍 **Search** within your catalog
- ▶️ **Direct Playback** — clicking a title shows all available versions from TorBox ready to stream in Stremio's player
- ⚡ Supports both **Torrents and Usenet** from TorBox
- 💾 Smart caching to avoid hammering the APIs

---

### 🚀 Quick Deploy

#### Option 1 — Vercel (recommended, free)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/torbox-stremio-addon)

1. Fork or clone this repository on GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Click **Deploy** (no environment variables needed — API keys are configured by the user inside Stremio)

**Addon URL:** `https://your-project.vercel.app`

---

#### Option 2 — Render (free)

1. Fork this repository on GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect the repository
4. Render auto-detects `render.yaml`
5. Click **Create Web Service**

**Addon URL:** `https://your-project.onrender.com`

> ⚠️ On Render's free tier, the service sleeps after inactivity. The first request after sleep may take ~30s to respond.

---

### 🔧 Stremio Configuration

After deploying, install the addon in Stremio:

1. Open Stremio → **Settings** → **Addons**
2. Paste the addon URL with `/configure` at the end:
   ```
   https://your-project.vercel.app/configure
   ```
3. On the configuration page, fill in:
   - **TorBox API Key** — get it at [torbox.app/settings/api](https://torbox.app/settings/api)
   - **TMDB API Key (v3)** — get it at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   - **Sort by** — choose between: Date Added, Release Date, Title
4. Click **Install**

Or install directly via URL:
```
stremio://your-project.vercel.app/manifest.json
```

---

### 🛠️ Local Development

```bash
# Install dependencies
npm install

# Run locally (port 7860)
npm start

# Or with hot-reload
npm run dev
```

Open `http://localhost:7860` to see the manifest.  
To configure locally, go to: `http://localhost:7860/configure`

> Requires **Node.js >= 18**.

---

### 📁 Project Structure

```
torbox-stremio-addon/
├── Index.js          # Local entry point (starts server on port 7860)
├── app.js            # Express setup + Stremio addon routes
├── api/
│   └── server.js     # Serverless entry point (Vercel)
├── src/
│   ├── torbox.js     # TorBox API integration
│   ├── tmdb.js       # TMDB API integration
│   ├── builder.js    # Builds catalog, meta, and stream responses
│   └── parser.js     # Smart filename parser (title, year, season/episode)
├── configure.html    # Addon configuration page
├── vercel.json       # Vercel deployment config
└── package.json
```

---

### 🔑 APIs Used

#### TorBox API
- `GET /v1/api/torrents/mylist` — lists all torrents
- `GET /v1/api/usenet/mylist` — lists all usenet downloads
- `GET /v1/api/torrents/requestdl` — generates a direct download link

#### TMDB API
- `GET /search/movie` and `/search/tv` — search by title
- `GET /movie/{id}` and `/tv/{id}` — full metadata
- `GET /tv/{id}/season/{n}` — season episodes

---

### ⚙️ How It Works

```
Stremio requests catalog
       ↓
TorBox API → fetches completed downloads
       ↓
Parser → extracts title, year, season/episode from filename
       ↓
TMDB API → fetches metadata (poster, synopsis, etc.)
       ↓
Organized catalog is returned to Stremio

User clicks a title
       ↓
TorBox API → lists files inside the download
       ↓
TorBox API → generates direct link for each video file
       ↓
Streams appear in Stremio's player for playback
```

---

### 🐛 Troubleshooting

**Empty catalog:**
- Make sure your API keys are correct
- Confirm that there are **completed** downloads in TorBox
- Check server logs for errors

**Wrong posters:**
- The parser tries to match filenames against TMDB; heavily modified names may fail to match
- Results are cached for 24h — restart the server if you need to reprocess

**Streams not showing:**
- TorBox links expire; reopen the title to generate new ones
- Make sure the file is a supported video format (`.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.wmv`, `.webm`)

---

### 📄 License

MIT
