This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## 環境變數

在專案根目錄建立 `.env.local`（可複製 `.env.example`），設定後需重啟 dev server 才生效。
這些設定僅存在於伺服器端，不加 `NEXT_PUBLIC_` 前綴，不會被打包進瀏覽器。

| 名稱 | 必填 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | 是 | 無 | 呼叫 Claude API 用的金鑰。 |
| `MODEL` | 否 | `haiku` | chat 使用的 LLM 模型，可填別名（`fable` / `opus` / `sonnet` / `haiku`）或完整 model ID（例如 `claude-sonnet-5`）。空字串或純空白視同未設定。 |
| `QADB_MCP_URL` | 否 | 無 | qadb MCP server 的 HTTP endpoint，助手用它查詢實際營運資料。開發環境為 `http://localhost:5152/graphql/mcp`。留空即不掛載 qadb，助手仍能回答一般財務問題。 |

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
