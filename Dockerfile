# Cert Forge — Next.js standalone container (listens on $PORT, default 8080)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public client config, inlined into the browser bundle at build time. Pass
# your own values: docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#   --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# Only ever the publishable/anon key here, never a service-role key.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build
# Optional exam-guide PDFs for /api/guide/[code]. Not part of this repository;
# if you have licensed copies, drop them in guides/ before building. They are
# renamed to ASCII "<exam-code>.pdf" because the published names carry an en
# dash. With no guides/ folder the route simply returns 404.
RUN mkdir -p /app/guides-ascii && for f in guides/*.pdf; do \
      [ -e "$f" ] || continue; \
      case "$f" in \
        *Associate*) c=CCAO-F ;; \
        *Developer*) c=CCDV-F ;; \
        *Architect*Professional*) c=CCAR-P ;; \
        *Architect*Foundations*) c=CCAR-F ;; \
        *) echo "unmapped guide: $f" && exit 1 ;; \
      esac; \
      cp "$f" "/app/guides-ascii/$c.pdf"; \
    done && ls /app/guides-ascii

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/guides-ascii ./guides
EXPOSE 8080
CMD ["node", "server.js"]
