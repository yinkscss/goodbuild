# One image for both GoodBuild processes (D25). Set the command per service:
#   web:     the default below
#   worker:  pnpm worker
#   release: pnpm db:migrate (before each deploy)
# Run the web service with GOODBUILD_INLINE_WORKER=0, so turns only run in the worker.
# Runtime variables are listed in docs/HANDOFF.md. NEXT_PUBLIC_* are fixed at build time.
FROM node:24-slim

# The run check's headless browser and the system libraries it needs (D67). It comes before the
# app's own files so a normal deploy reuses this layer. The version must be the playwright-core
# version in package.json (run-check.test.ts checks it): the two sides speak a versioned protocol.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright-core@1.65.0 install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* /root/.npm \
  && chmod -R a+rX /ms-playwright

ENV COREPACK_HOME=/corepack
RUN corepack enable && mkdir -p /corepack && chown node:node /corepack

WORKDIR /app
RUN chown node:node /app
USER node

# A full install, dev packages included: tsx runs the worker, drizzle-kit runs migrations, and
# compiling contracts reads node_modules at runtime, so this can't be pruned or made standalone.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node publish-runtime/package.json publish-runtime/
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

ARG NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_TEST_GD_ADDRESS
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY=$NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_TEST_GD_ADDRESS=$NEXT_PUBLIC_TEST_GD_ADDRESS \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL
# The mainnet switch is not a build value (D50): the server reads it from the database on every request.

RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
# PORT is read at start for hosts that set it. -H because Docker sets HOSTNAME to the container id.
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
