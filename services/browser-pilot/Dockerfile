FROM node:24-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /root/.cache/ms-playwright && mv /root/.cache/ms-playwright /opt/browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN useradd --create-home --uid 1001 browser
COPY *.mjs ./
USER browser
EXPOSE 8443
CMD ["node","server.mjs"]
