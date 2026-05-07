# MPP Demo — yan monitör notları (~30 dk)

Bu dosya **projektör/videoda gösterilen site değil**; presenter laptop’ta yan ekranda açılacak hatırlatmalar için.

**Canlı adres (izleyici):** Vercel’de deploy ettiğin URL (örn. `stellar-mpp-demo-six.vercel.app`) — veya yerel `http://localhost:3002`.

**Önce kontrol:** Status satırı yeşil/ok mi, wallets yükleniyor mu, bir free MCP çağrısı denendi mi?

---

## 0:00–0:04 · Açılış

- Bugün: Machine Payments Protocol (MPP) + Stellar Testnet ile **paid API** ve **paid MCP tool**.
- Vaat: Checkout / abonelik panosu yapmadan, **istemek → 402 → ödeme ispatı → aynı istek**.

---

## 0:04–0:09 · Problem çerçevesi (“neden?”)

- API veya MCP tool satmak klasik olarak: hesap, API key, faturalama, ayrı ödeme sayfası.
- Agent / otomasyon tarafında: her adımda “önce ödeme ekranı” akışını sürdürmek zor.
- MPP: **ödeme sinyali doğrudan HTTP / tool çevrimine** bağlı (özellikle **402 Payment Required** hikâyesi).

---

## 0:09–0:13 · 30 saniye Stellar

- Biz **Testnet**; Friendbot ile cüzdanlar görünür; gerçek ödeme challenge + (charge’da) gerçek settlement.
- “Her detayı CAP seviyesinde” değil; odak **akış**.

---

## 0:13–0:28 · Ana demo (sitelerinde gezinti)

Üst bloklar (kartlar): Charge / MCP / Channel — tek cümle: “bir istek için ücret”, “tool içinde ücret”, “çok çağrı için voucher”.

**Demo Flow kartları:**

1. **Show 402** → **Pay + unlock**  
   - “Şimdi ödeme yok: sunucu önce ne diyor?”  
   - Sonra ödeme ile aynı API’nin kilidi.

2. Wallets’a kay: **Buyer / Seller / Fee payer / Commitment key** tek cümle rol.

**Explorer Workbench:**

- **Discover tools** → listede ücretsiz / ücretli ayrımı.
- Ücretsiz tool seç → **Run selected tool** → anında çıktı.
- Ücretli tool → **Try selected without payment** → challenge / reddedilme görselle.
- Charge rail seçili → **Run selected tool** → ödeme + sonuç.
- **Activate channel session** → rail **channel** → aynı veya başka ücretli tool → “tekrar on-chain ödeme döngüsü” olmadan (voucher mantığıyla) anlat.

**Demo output (JSON):** Bir kez işaret et — “Ham cevap / debug burada; MCP panellerinde özet UI var.”

**Code panel (JS vurgulu, kısa):**  
Tek mesaj: “Bu route’un paid olması = `mppx/express` içindeki `payment(...)`.”  
Gerçek satıra git (Go to Line ~137 veya grep notundaki komutlar).

---

## 0:28–0:30 · Kapanış + “builder ne yapar?”

- Charge: öğretmesi kolay; channel: sık MCP/API çağrısı hikâyesi.
- Ürün düşün: ücretli data feed, RPC paketleri, MCP audit/explain araçları, agent marketplace parçası.
- **Tek cümle kapanış:**  
  “Ödeme ayrı bir ürün değil; **istenen response’un önündeki middleware**.”

---

## Süre sıkışırsa kesilecek bloklar (-5 dk için)

1. MCP’yi sadece 1 ücretsiz + 1 ücretli + 1 channel çağrısına indirgenir.  
2. Code paneli yerine “repo’da `payment(` ara” ile bırakılabilir.

---

## Olursa güzel tek soru

- “Charge ile channel’ı aynı serviste nasıl fiyatlarırsınız?” (demoda aynı fiyat; gerçekte policy / metering).

---

## Takılırsa (Plan B)

- `/api/status` ve `/api/free-insight` her zaman güvenilir “ısınma”.  
- Eğer tool listesi gelmezse: yenile → console / Demo output’a bak → “Testnet/API anlık yavaş” deyip charge akışını atla.

---

## Son kontrol listesi

- [ ] Projektör tarayıcısı tam ekran, zoom rahat okunur seviye  
- [ ] Yan monitörde **bu markdown** ; izleyicide **demo sitesi**  
- [ ] En az bir “boş slate”: Demo output Clear + MCP result temiz hissiyat için
