FROM node:24-slim
# python + python-docx are only needed for uploading 课后习题 Word files in the question-bank page
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --break-system-packages python-docx && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=3000 DATA_DIR=/data PYTHON=python3 NODE_ENV=production
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings", "server/index.js"]
