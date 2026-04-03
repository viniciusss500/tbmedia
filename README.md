```markdown
# 🎬 TB Media — TorBox Stremio Addon

> 🇧🇷 [Português](#português) · 🇺🇸 [English](#english)

---

## Português

Addon para o Stremio que exibe seu catálogo pessoal do **TorBox** (torrents e usenet) com metadados em **Português BR** obtidos do TMDB.

### ✨ Funcionalidades

- 📂 **Catálogo de Filmes, Séries e Animes** — exibe todo o conteúdo baixado no TorBox em três catálogos separados
- 🍥 **Catálogo de Animes** — detectado automaticamente via TMDB (idioma original japonês + gênero Animation), separado das séries normais
- 🇧🇷 **Metadados em PT-BR** — título, sinopse, pôster, backdrop, elenco, diretor, trailer e nota IMDB
- 📅 **Ordenação** por data de adição, data de lançamento ou título
- 🔍 **Busca** dentro do catálogo
- ▶️ **Reprodução direta** — ao clicar no título, as versões disponíveis no TorBox aparecem para play no Stremio
- 🎯 **Filtro de episódios** — a tela de detalhes exibe apenas os episódios que você realmente tem no TorBox
- 📦 **Suporte a packs multi-episódio** — arquivos no formato `S02E02-03` são mapeados corretamente
- 🏷️ **Streams detalhadas** — cada stream exibe qualidade (4K/1080p/720p), codec (H.265/H.264/AV1), HDR/Dolby Vision, idioma (Dublado/PT-BR/Legendado), áudio (Atmos/TrueHD/DTS) e tamanho do arquivo
- 🔀 **Ordenação inteligente de streams** — priorizadas por idioma PT-BR → legendado → qualidade → tamanho
- 🔗 **Compatibilidade com IMDB ID** — streams funcionam ao abrir títulos de outros addons pelo ID IMDB
- ⚡ Suporte a **Torrents e Usenet** do TorBox
- 🗄️ **Cache Redis (Upstash)** — cache persistente entre requests, compatível com ambientes serverless
- 🔄 **Background refresh** — em auto-hospedagem, o catálogo é atualizado automaticamente a cada 30 minutos
- 🩺 **Endpoint `/health`** — monitore o status do addon e do cache Redis
- 🐳 **Docker ready** — imagem oficial publicada no GHCR

---

### 🚀 Deploy Rápido

#### Opção 1 — Vercel (recomendado, grátis)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vinip1250-art/tbmedia)

1. Faça um fork/clone deste repositório no GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Clique em **Deploy** (sem variáveis de ambiente obrigatórias — as chaves são configuradas pelo usuário no Stremio)
4. *(Opcional)* Configure `UPSTASH_REDIS_URL` nas variáveis de ambiente para habilitar cache Redis persistente

**URL do addon:** `https://seu-projeto.vercel.app`

> 💡 Sem Redis configurado o addon funciona normalmente, apenas sem cache entre requests serverless.

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

#### Opção 3 — Docker / Auto-hospedagem (recomendado para uso contínuo)

Use a imagem pré-compilada do GitHub Container Registry:

```yaml
# compose.yml
services:
  tbmedia:
    image: ghcr.io/vinip1250-art/tbmedia:latest
    container_name: tbmedia
    restart: unless-stopped
    ports:
      - "7860:7860"
    environment:
      - PORT=7860
      # Opcional: habilita cache Redis persistente
      # - UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7860/"]
      interval: 30s
      timeout: 5s
      retries: 3
```

```bash
docker compose up -d
```

**URL do addon:** `http://seu-servidor:7860`

> 💡 Em modo Docker, o background refresh atualiza o catálogo automaticamente a cada 30 minutos.

---

### 🔧 Configuração no Stremio

Após o deploy, instale o addon no Stremio:

1. Abra o Stremio → **Configurações** → **Addons**
2. Cole a URL de configuração:
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

> Requer **Node.js >= 24**.

---

### 📁 Estrutura do Projeto

```
tbmedia/
├── index.js          # Entry point local (inicia o servidor na porta 7860)
├── app.js            # Configuração Express + rotas do addon Stremio
├── api/
│   └── server.js     # Entry point serverless (Vercel)
├── src/
│   ├── torbox.js     # Integração com a API do TorBox
│   ├── tmdb.js       # Integração com a API do TMDB (PT-BR) + conversão IMDB→TMDB
│   ├── builder.js    # Constrói catálogo, meta e streams + scoring de streams
│   ├── parser.js     # Parser inteligente de nomes de arquivos (título, ano, S/E, anime)
│   └── cache.js      # Camada de cache Redis (Upstash) com fallback gracioso
├── public/
│   └── tb-files-tmdb-icon.svg  # Logo SVG leve do addon
├── configure.html    # Página de configuração do addon
├── Dockerfile        # Imagem Docker (node:20-alpine)
├── compose.yml       # Docker Compose para auto-hospedagem
├── vercel.json       # Config para deploy no Vercel
└── package.json
```

---

### 🔑 APIs Utilizadas

#### TorBox API
- `GET /v1/api/torrents/mylist` — lista todos os torrents
- `GET /v1/api/usenet/mylist` — lista todos os downloads usenet
- `GET /v1/api/torrents/requestdl` — gera link de download direto (torrent)
- `GET /v1/api/usenet/requestdl` — gera link de download direto (usenet)

#### TMDB API (PT-BR)
- `GET /search/movie` e `/search/tv` — busca por título (com detecção de anime via `original_language` + `genre_ids`)
- `GET /movie/{id}` e `/tv/{id}` — metadados completos (com `append_to_response=videos,images`)
- `GET /tv/{id}/season/{n}` — episódios de cada temporada
- `GET /tv/{id}/credits` e `/movie/{id}/credits` — elenco e direção
- `GET /tv/{id}/external_ids` — ID IMDB para deep link
- `GET /find/{imdb_id}` — conversão de IMDB ID para TMDB ID

---

### ⚙️ Como Funciona

```
Stremio solicita catálogo
       ↓
Cache Redis → hit? retorna imediatamente
       ↓ (miss)
TorBox API → lista downloads concluídos (completed/seeding/cached/finalized)
       ↓
Parser → extrai título, ano, temporada/episódio, detecta anime
       ↓
TMDB API → busca metadados em PT-BR
           └── anime: valida idioma original japonês + gênero Animation
       ↓
Catálogo separado por tipo (Filmes / Séries / Animes) retorna ao Stremio
       ↓
Cache Redis → armazena por 1 hora

─────────────────────────────────────────────────────

Usuário clica em um título (tela de meta)
       ↓
TMDB API → busca todos os episódios da série
       ↓
TorBox → filtra apenas episódios disponíveis no seu acervo
       ↓
Apenas os episódios que você tem são exibidos

─────────────────────────────────────────────────────

Usuário clica em um episódio (streams)
       ↓
TorBox API → lista arquivos do download (suporta packs multi-ep S02E02-03)
       ↓
TorBox API → gera link direto para cada arquivo de vídeo
       ↓
Streams ordenadas por: idioma PT-BR → qualidade (4K/1080p) → tamanho
       ↓
Stremio reproduz diretamente do CDN do TorBox (sem proxy)
```

---

### 🗄️ Cache Redis (Upstash)

O addon suporta cache Redis via [Upstash](https://upstash.com) (plano gratuito disponível). Configure a variável de ambiente:

```
UPSTASH_REDIS_URL=rediss://default:SUA_SENHA@xxx.upstash.io:6379
```

| Dado | TTL |
|---|---|
| Catálogo | 1 hora |
| Metadados (meta) | 24 horas |
| Conversão IMDB → TMDB | 7 dias |
| Manifest | 24 horas |
| Streams | 10 minutos |

Sem Redis configurado, o addon funciona normalmente — o cache fica apenas em memória (sem persistência entre requests no Vercel).

---

### 🩺 Health Check

```
GET /health
```

Retorna o status do servidor e do cache Redis:

```json
{
  "status": "ok",
  "cache": { "connected": true, "dbsize": 142 },
  "environment": "self-hosted",
  "version": "1.4.1"
}
```

---

### 🐛 Solução de Problemas

**Catálogo vazio:**
- Verifique se as chaves de API estão corretas
- Confirme que há downloads **concluídos** no TorBox (estados aceitos: `completed`, `seeding`, `cached`, `finalized`)
- Acesse `/health` para verificar se o Redis está conectado
- Verifique os logs do servidor para erros

**Animes aparecendo nas Séries (ou vice-versa):**
- A detecção usa o TMDB: somente títulos com idioma original japonês + gênero Animation vão para o catálogo de Animes
- Se um anime não aparecer no catálogo correto, pode ser que o nome do arquivo esteja muito modificado

**Pôsters incorretos:**
- O parser tenta casar o nome do arquivo com o TMDB; nomes muito modificados podem falhar
- O cache Redis preserva correspondências — use `/health` para verificar e reinicie se necessário

**Streams não aparecem:**
- Os links do TorBox são assinados e expiram (~10 min); reabra o título para gerar novos
- Verifique se o arquivo é um formato de vídeo suportado: `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.wmv`, `.webm`
- Se abriu o título por outro addon (usando IMDB ID), o addon tenta a conversão IMDB → TMDB automaticamente

**Usenet não aparece:**
- Usenet requer plano pago no TorBox; se não estiver disponível no seu plano, o addon ignora silenciosamente

---

---

## English

A Stremio addon that displays your personal **TorBox** catalog (torrents and usenet) with metadata fetched from TMDB.

### ✨ Features

- 📂 **Movies, Series & Anime Catalogs** — displays all content downloaded on TorBox in three separate catalogs
- 🍥 **Anime Catalog** — automatically detected via TMDB (original language Japanese + Animation genre), separated from regular series
- 🌐 **TMDB Metadata** — title, synopsis, poster, backdrop, cast, director, trailer and IMDB rating
- 📅 **Sorting** by date added, release date, or title
- 🔍 **Search** within your catalog
- ▶️ **Direct Playback** — clicking a title shows all available versions from TorBox ready to stream in Stremio's player
- 🎯 **Episode filtering** — the detail screen shows only episodes you actually have in TorBox
- 📦 **Multi-episode pack support** — files named `S02E02-03` are correctly mapped
- 🏷️ **Rich stream info** — each stream shows quality (4K/1080p/720p), codec (H.265/H.264/AV1), HDR/Dolby Vision, language (Dubbed/PT-BR/Subbed), audio (Atmos/TrueHD/DTS) and file size
- 🔀 **Smart stream sorting** — prioritized by PT-BR language → subtitled → quality → size
- 🔗 **IMDB ID compatibility** — streams work when opening titles from other addons via IMDB ID
- ⚡ Supports both **Torrents and Usenet** from TorBox
- 🗄️ **Redis Cache (Upstash)** — persistent cache between requests, serverless-compatible
- 🔄 **Background refresh** — in self-hosted mode, the catalog updates automatically every 30 minutes
- 🩺 **`/health` endpoint** — monitor addon and Redis cache status
- 🐳 **Docker ready** — official image published on GHCR

---

### 🚀 Quick Deploy

#### Option 1 — Vercel (recommended, free)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vinip1250-art/tbmedia)

1. Fork or clone this repository on GitHub
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Click **Deploy** (no required environment variables — API keys are configured by the user inside Stremio)
4. *(Optional)* Set `UPSTASH_REDIS_URL` in environment variables to enable persistent Redis cache

**Addon URL:** `https://your-project.vercel.app`

---

#### Option 2 — Render (free)

1. Fork this repository on GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect the repository
4. Render auto-detects `render.yaml`
5. Click **Create Web Service**

**Addon URL:** `https://your-project.onrender.com`

> ⚠️ On Render's free tier, the service sleeps after inactivity. The first request after sleep may take ~30s.

---

#### Option 3 — Docker / Self-hosted (recommended for continuous use)

```yaml
# compose.yml
services:
  tbmedia:
    image: ghcr.io/vinip1250-art/tbmedia:latest
    container_name: tbmedia
    restart: unless-stopped
    ports:
      - "7860:7860"
    environment:
      - PORT=7860
      # Optional: enables persistent Redis cache
      # - UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7860/"]
      interval: 30s
      timeout: 5s
      retries: 3
```

```bash
docker compose up -d
```

**Addon URL:** `http://your-server:7860`

---

### 🔧 Stremio Configuration

After deploying, install the addon in Stremio:

1. Open Stremio → **Settings** → **Addons**
2. Paste the configuration URL:
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

> Requires **Node.js >= 24**.

---

### 📁 Project Structure

```
tbmedia/
├── index.js          # Local entry point (starts server on port 7860)
├── app.js            # Express setup + Stremio addon routes
├── api/
│   └── server.js     # Serverless entry point (Vercel)
├── src/
│   ├── torbox.js     # TorBox API integration
│   ├── tmdb.js       # TMDB API integration + IMDB→TMDB conversion
│   ├── builder.js    # Builds catalog, meta, streams + stream scoring
│   ├── parser.js     # Smart filename parser (title, year, season/episode, anime)
│   └── cache.js      # Redis (Upstash) cache layer with graceful fallback
├── public/
│   └── tb-files-tmdb-icon.svg  # Lightweight SVG addon logo
├── configure.html    # Addon configuration page
├── Dockerfile        # Docker image (node:20-alpine)
├── compose.yml       # Docker Compose for self-hosting
├── vercel.json       # Vercel deployment config
└── package.json
```

---

### 🔑 APIs Used

#### TorBox API
- `GET /v1/api/torrents/mylist` — lists all torrents
- `GET /v1/api/usenet/mylist` — lists all usenet downloads
- `GET /v1/api/torrents/requestdl` — generates direct download link (torrent)
- `GET /v1/api/usenet/requestdl` — generates direct download link (usenet)

#### TMDB API
- `GET /search/movie` and `/search/tv` — search by title (with anime detection via `original_language` + `genre_ids`)
- `GET /movie/{id}` and `/tv/{id}` — full metadata (with `append_to_response=videos,images`)
- `GET /tv/{id}/season/{n}` — season episodes
- `GET /tv/{id}/credits` and `/movie/{id}/credits` — cast and crew
- `GET /tv/{id}/external_ids` — IMDB ID for deep linking
- `GET /find/{imdb_id}` — convert IMDB ID to TMDB ID

---

### ⚙️ How It Works

```
Stremio requests catalog
       ↓
Redis Cache → hit? return immediately
       ↓ (miss)
TorBox API → fetches completed downloads (completed/seeding/cached/finalized)
       ↓
Parser → extracts title, year, season/episode, detects anime
       ↓
TMDB API → fetches metadata
           └── anime: validates Japanese original language + Animation genre
       ↓
Separate catalog by type (Movies / Series / Anime) returned to Stremio
       ↓
Redis Cache → stored for 1 hour

─────────────────────────────────────────────────────

User opens a title (meta screen)
       ↓
TMDB API → fetches all episodes for the series
       ↓
TorBox → filters only episodes available in your library
       ↓
Only the episodes you own are displayed

─────────────────────────────────────────────────────

User clicks an episode (streams)
       ↓
TorBox API → lists files in the download (supports multi-ep packs S02E02-03)
       ↓
TorBox API → generates direct signed link for each video file
       ↓
Streams sorted by: PT-BR language → quality (4K/1080p) → file size
       ↓
Stremio plays directly from TorBox CDN (zero proxy bytes)
```

---

### 🗄️ Redis Cache (Upstash)

The addon supports Redis caching via [Upstash](https://upstash.com) (free tier available). Set the environment variable:

```
UPSTASH_REDIS_URL=rediss://default:YOUR_PASSWORD@xxx.upstash.io:6379
```

| Data | TTL |
|---|---|
| Catalog | 1 hour |
| Metadata (meta) | 24 hours |
| IMDB → TMDB conversion | 7 days |
| Manifest | 24 hours |
| Streams | 10 minutes |

Without Redis, the addon works normally — cache stays in memory only (no persistence between serverless requests on Vercel).

---

### 🩺 Health Check

```
GET /health
```

Returns server and Redis cache status:

```json
{
  "status": "ok",
  "cache": { "connected": true, "dbsize": 142 },
  "environment": "self-hosted",
  "version": "1.4.1"
}
```

---

### 🐛 Troubleshooting

**Empty catalog:**
- Make sure your API keys are correct
- Confirm that there are **completed** downloads in TorBox (accepted states: `completed`, `seeding`, `cached`, `finalized`)
- Check `/health` to verify Redis is connected
- Check server logs for errors

**Anime showing in Series (or vice versa):**
- Detection uses TMDB: only titles with Japanese original language + Animation genre go to the Anime catalog
- If an anime doesn't appear in the correct catalog, the filename may be too modified for the parser to match

**Wrong posters:**
- The parser tries to match filenames against TMDB; heavily modified names may fail
- Redis preserves match results — check `/health` and restart if needed

**Streams not showing:**
- TorBox links are signed and expire (~10 min); reopen the title to generate new ones
- Make sure the file is a supported video format: `.mkv`, `.mp4`, `.avi`, `.mov`, `.m4v`, `.ts`, `.wmv`, `.webm`
- If you opened the title from another addon (via IMDB ID), the addon attempts IMDB → TMDB conversion automatically

**Usenet not showing:**
- Usenet requires a paid TorBox plan; if unavailable on your plan, the addon silently ignores it

---

### 📄 License

MIT
```

***
