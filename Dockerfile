# Base leve
FROM node:20-alpine

# Diretório da app
WORKDIR /app

# Copia só dependências primeiro (melhor cache)
COPY package*.json ./

# Instala apenas produção
RUN npm ci --omit=dev

# Copia resto do projeto
COPY . .

# Porta do app
EXPOSE 7860

# Variável padrão
ENV PORT=7860

# Start correto
CMD ["npm", "start"]
