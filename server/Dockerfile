FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
# 多进程:默认 2 个 worker,避免单进程被慢请求(缩略图冷生成/大文件代理)占满时全站阻塞。
# 可用 UVICORN_WORKERS 覆盖(建议 = CPU 核数,且数据库须为 PostgreSQL;SQLite 多写会锁)。
# shell 形式以便展开环境变量。
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}
