Migrações e instruções para Neon (Postgres)

1) Executar a migração SQL localmente (psql):

```bash
psql "postgres://user:password@host:port/dbname" -f migrations/001_create_tables.sql
```

2) No painel do Neon, você pode usar o editor SQL e colar o conteúdo de `migrations/001_create_tables.sql` e executar.

3) Inserir a `admin_key` inicial no banco:

```sql
INSERT INTO app_settings (name, value) VALUES ('admin_key', 'COLE_SUA_CHAVE_AQUI');
```

4) Configurar variável de ambiente no Vercel:
- Nome: `DATABASE_URL`
- Valor: `postgres://user:password@host:port/dbname`

5) Em desenvolvimento local, coloque `DATABASE_URL` e `ADMIN_KEY` no arquivo `.env`.

6) Próximos passos para integrar a aplicação ao Neon:
- Substituir as funções de leitura/escrita em `lib/db.js` por consultas ao Postgres (posso gerar o código SQL/JS para isso se desejar).
