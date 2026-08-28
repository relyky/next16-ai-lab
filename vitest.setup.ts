import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { resetChatStoreForTest } from '@/lib/chat-store'

// vitest 未啟用 globals，RTL 不會自動註冊 cleanup，需手動掛上。
afterEach(() => {
  cleanup()
  // 對話狀態住在 module-scope 的 store，卸載不會重置它；不顯式歸零的話
  // 上一個測試的訊息與 sessionId 會殘留到下一個測試。
  resetChatStoreForTest()
})

// jsdom 沒有實作 Element.prototype.scrollTo，而 Streamdown 的程式碼區塊
// 會在串流時自動捲到底。缺這個 API 會讓 effect 直接拋例外，連帶讓
// 該次 render 的斷言失敗——補上一個 no-op 即可，測試不驗證捲動行為。
// 純 node 環境的測試檔沒有 Element，故先確認再補。
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}
