// 打包入口：scripts/bundle-sdk.sh 用嚟將官方 @anthropic-ai/sdk 打包成 server/vendor/anthropic-sdk.mjs
// （Cloudflare Pages 冇 build 步驟，唔會 npm install，所以要預先打包）
export { default } from "@anthropic-ai/sdk";
