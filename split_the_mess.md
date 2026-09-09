# PROJECT PROPOSAL: SPLIT THE MESS V2
## Fair & Frictionless Group Bill Splitter (WhatsApp Bot + Web App Hybrid)

---

## 1. Executive Summary

**Split the Mess** adalah solusi pembagi tagihan kelompok berbasis pendekatan hibrida (WhatsApp Bot + Web App) yang dirancang untuk menyelesaikan kerumitan, ketidakadilan, dan kecanggungan saat makan bersama. Aplikasi ini mengubah struk fisik yang membingungkan menjadi pembagian biaya yang adil dan presisi berdasarkan konsumsi riil masing-masing individu.

Dengan mengintegrasikan Bot WhatsApp sebagai pintu masuk utama, pengguna tidak perlu mengunduh aplikasi baru atau melewati proses pendaftaran yang rumit. Bot akan merespons foto struk atau perintah di dalam grup WhatsApp, lalu menyediakan *link* Web App interaktif yang *aesthetic*, serba instan, dan mendukung sinkronisasi *real-time* saat masing-masing anggota memilih menu yang mereka konsumsi. Setelah selesai, ringkasan tagihan beserta rincian proporsional (pajak, layanan, diskon) dan rincian pembayaran (QRIS/Transfer) akan dikirimkan kembali secara otomatis ke grup WhatsApp.

---

## 2. Problem Statement (Latar Belakang Masalah)

- **Hambatan Adopsi Aplikasi Terpisah (*App Friction*):** Pengguna sering enggan mengunduh aplikasi baru hanya untuk membagi tagihan sesekali, serta enggan melakukan proses pendaftaran/login yang memakan waktu saat berada di meja makan.
- **Pembagian Rata yang Tidak Adil:** Membagi tagihan secara rata (*equal split*) merugikan individu yang memesan menu lebih murah, tidak minum alkohol, atau makan lebih sedikit.
- **Kerumitan Perhitungan Manual:** Menghitung manual siapa makan apa, ditambah PPN (pajak), *service charge*, serta diskon promo di akhir makan sangat memusingkan dan rawan kesalahan.
- **Kecanggungan Sosial (*Social Awkwardness*):** Merasa canggung saat harus menagih nominal spesifik hingga pecahan rupiah kecil kepada teman.
- **Keterbatasan Tampilan WhatsApp Chat Murni:** Antarmuka chat WhatsApp biasa terlalu terbatas (hanya teks dan tombol sederhana) untuk menampilkan menu struk yang kompleks, dan penggunaan tombol balasan berlebih di grup dapat menyebabkan penumpukan pesan (*spamming*).

---

## 3. Proposed Solution & UI/UX Concept

Solusi yang ditawarkan menggunakan **Pendekatan Hibrida (WhatsApp + Real-time Web App)** untuk menggabungkan jangkauan luas WhatsApp dengan kebebasan desain antarmuka Web App yang *aesthetic* dan intuitif.

### Komponen Antarmuka Solusi:
- **WhatsApp Group Bot (Entry Point):** Bot hadir dalam grup WhatsApp sebagai asisten otomatis yang menerima foto struk dan mengirimkan rincian hasil akhir tagihan.
- **Aesthetic Real-time Web App (Interactive Interface):** Halaman web ringan yang dibuka langsung melalui *in-app browser* WhatsApp tanpa perlu instalasi. Menampilkan daftar menu dengan desain visual yang rapi, modern, dan mendukung sinkronisasi interaksi secara langsung (*live update*).

### Contoh Alur & Visualisasi Data:

#### 1. Pesan Bot di Grup WhatsApp:
```text
🤖 [Split the Mess Bot]
Struk berhasil di-scan! 🧾
Total Tagihan: Rp350.000 (Termasuk Tax & Service)

Silakan klik link di bawah untuk memilih pesanan masing-masing:
https://splitthemess.app/session/xyz123
```

#### 2. Antarmuka Web App (Hasil Ekstraksi OCR):

| Item Menu | Harga Nominal | Pilihan Konsumen (Live) |
| :--- | :--- | :--- |
| 🍕 Pizza Pepperoni | Rp85.000 | Akmal, Fajar |
| 🍔 Cheeseburger | Rp45.000 | Rizky |
| ☕ Iced Latte | Rp30.000 | Dimas, Nadia |
| 🍗 Fried Chicken | Rp60.000 | Nadia |

#### 3. Ringkasan Final Kiriman Bot ke Grup WhatsApp:
```text
📊 RINGKASAN SPLIT BILL (SPLIT THE MESS)

1. Akmal    : Rp82.350
2. Rizky    : Rp71.200
3. Fajar    : Rp96.550
4. Dimas    : Rp48.900
5. Nadia    : Rp55.000
-----------------------------------
TOTAL      : Rp354.000 (Presisi Struk)

💳 Pembayaran dapat ditransfer ke:
BCA: 1234567890 a.n. Akmal
Atau via QRIS: https://splitthemess.app/qris/xyz123
```

---

## 4. Core Features (Fitur Utama)

- **WhatsApp Group Trigger & Webhook Integration:** Pengguna cukup mengunggah foto struk ke dalam grup WhatsApp dan memanggil bot (misal: `/split`), bot akan merespons secara otomatis.
- **Zero-Installation Interactive Web App:** *Link* unik yang dibuat oleh bot dapat dibuka oleh siapa saja dalam grup tanpa perlu membuat akun atau menginstal aplikasi terpisah.
- **Real-time Synchronized Selection:** Menggunakan protokol WebSocket untuk memperbarui status pemilihan pesanan secara instan saat ada anggota grup yang memilih atau membatalkan pesanan.
- **Proportional Tax, Service, & Promo Distribution:** Menghitung biaya PPN, *service charge*, dan diskon secara matematis dan proporsional berdasarkan subtotal nominal pesanan masing-masing individu.
- **Smart Rounding & Settlement Link:** Pembulatan otomatis yang menjamin total akhir semua anggota sama persis dengan total pada struk fisik hingga nominal rupiah terkecil. Hasil akhir dipublikasikan kembali ke grup beserta *link* pembayaran QRIS atau info rekening.

---

## 5. Advanced Features (Fitur Cerdas / AI)

- **AI-Powered Receipt OCR & Contextual Parsing:**
  - Penerimaan dan pemrosesan foto struk yang miring, bergelombang, atau berpencahayaan rendah.
  - Ekstraksi otomatis untuk memisahkan nama menu, harga item, *add-ons/modifiers*, PPN (11%), *Service Charge*, serta potongan diskon.
- **Automated Payment Reminders via WhatsApp:** Bot WhatsApp dapat secara halus mengirimkan pengingat (*reminder*) ke grup atau *private chat* kepada anggota yang belum mengonfirmasi pembayaran.

---

## 6. User Journey (Alur Pengguna Hibrida)

| Langkah | Aktivitas Pengguna | Sistem / Bot Response |
| :--- | :--- | :--- |
| **1. Inisiasi** | User mengunggah foto struk ke grup WhatsApp dengan perintah `/split`. | WhatsApp Bot menerima foto dan meneruskannya ke backend AI OCR. |
| **2. Parsing AI** | User menunggu beberapa detik saat AI memproses struk. | Sistem OCR mengekstrak item, harga, pajak, dan diskon, lalu membuat sesi Web App unik. |
| **3. Pembagian Link** | Semua anggota grup melihat pesan konfirmasi dari Bot di WhatsApp. | Bot mengirimkan pesan berisi ringkasan awal dan link Web App interaktif ke grup. |
| **4. Pemilihan Menu** | Anggota grup mengklik link, memilih makanan/minuman masing-masing pada UI Web App yang aesthetic. | Web App melakukan sinkronisasi real-time via WebSocket sehingga pilihan setiap orang langsung terlihat di HP anggota lain. |
| **5. Kalkulasi Final** | Admin/Penanggung jawab menekan tombol "Selesai & Hitung". | Sistem menghitung rasio pajak/diskon proporsional dan pembulatan rupiah. |
| **6. Pelunasan** | Anggota grup menerima rincian final di grup WA dan melakukan pembayaran via QRIS/Transfer. | Bot mengirimkan rincian lengkap beserta QRIS ke grup WA dan memperbarui status pembayaran. |

---

## 7. Recommended Tech Stack

| Komponen | Teknologi Direkomendasikan | Peran & Deskripsi |
| :--- | :--- | :--- |
| **WhatsApp Interface** | WhatsApp Business API / Baileys / Twilio for WhatsApp | Menangani pesan masuk/keluar, mendeteksi foto struk di grup, dan mengirim link/ringkasan. |
| **Frontend (Web App)** | Next.js / React / Vue.js + Tailwind CSS | Membuat antarmuka web yang ringan, cepat, responsive, dan aesthetic di in-app browser. |
| **Real-time State Sync** | Socket.io / Supabase Realtime / Firebase | Menyinkronkan pilihan menu secara instan ke semua HP pengguna secara bersamaan. |
| **Backend API** | Node.js (Express / NestJS) atau Python (FastAPI) | Mengelola logika bisnis, webhook WhatsApp, dan kalkulasi matematis proporsional. |
| **Database & Cache** | PostgreSQL + Redis | PostgreSQL untuk penyimpanan sesi transaksi; Redis untuk caching state temporary dan sesi real-time. |
| **AI / Receipt OCR** | Google Cloud Vision API / Veryfi API / AWS Textract | Mengekstrak data teks, harga, PPN, dan struktur dari foto struk belanja. |

---

## 8. Project Evaluation

- **Technical Complexity:** ⭐⭐⭐⭐ (Tingkat Kesulitan: *Advanced*)
  - *Tantangan:* Mengintegrasikan Webhook WhatsApp API dengan backend, membangun arsitektur Web App *real-time* yang bebas instalasi, penanganan OCR struk yang bervariasi, serta algoritma pembagian proporsional yang presisi.
- **Portfolio Impact:** ⭐⭐⭐⭐⭐ (Nilai Portofolio: *Sangat Tinggi*)
  - *Alasan:* Menggabungkan solusi UX bebas hambatan (*Zero-Friction UX*) menggunakan WhatsApp Bot, antarmuka Web App *real-time* yang modern dan estetik, integrasi Computer Vision/AI, serta arsitektur backend hibrida yang sangat relevan dengan kebutuhan industri software modern.