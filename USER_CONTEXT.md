# USER_CONTEXT.md

Bu dosya, Codex’in kullanıcıyla çalışırken dikkate alması gereken kalıcı tercihleri ve mevcut imkânları özetler. Parola, API anahtarı, token, gerçek webhook adresi veya başka gizli değerler bu dosyaya yazılmamalıdır.

## Kullanıcının Çalışma Biçimi

- Kullanıcı profesyonel yazılımcı değildir.
- Projeyi doğal dil kullanarak ve yeni fikirler geldikçe sürekli geliştirir.
- Proje tamamlanmış, sabit bir ürün değildir; büyüyen ve değişen bir sistemdir.
- Kullanıcı kod geliştirmenin yanında ürün ve pazar araştırması, otomasyon, yapay zekâ araçları ve iş akışı geliştirme konularında öneri bekler.
- Teknik açıklamalar sade Türkçe yapılmalıdır.
- Kullanıcı açıkça istemedikçe büyük refactor veya mimari değişiklik yapılmamalıdır.
- Küçük, kontrollü, test edilebilir ve geri alınabilir değişiklikler tercih edilmelidir.
- Mevcut çalışan sistemi korumak önceliklidir.

## Mevcut Araçlar ve Abonelikler

Kullanıcının mevcut araç ve abonelikleri:

- ChatGPT Plus ve Codex
- eRank düşük seviyeli ücretli paket
- Helium 10
- Keepa
- Canva Pro
- Gemini orta seviyeli ücretli paket
- GitHub
- Vercel
- Supabase
- Make.com

Bu araçların planları, özellikleri, kotaları, fiyatları ve kullanım limitleri zamanla değişebilir. Güncel durum doğrulanmadan kesin varsayım yapılmamalıdır.

## Maliyet Yaklaşımı

- Öncelik ücretsiz, açık kaynaklı veya mevcut aboneliklere dahil çözümlerdir.
- Yeni sürekli aboneliklerden mümkün olduğunca kaçınılmalıdır.
- Çok düşük maliyetli bir çözüm belirgin ve ölçülebilir fayda sağlıyorsa ayrıca belirtilebilir.
- Ücretli bir araç, API veya servis önerildiğinde ücretli olduğu açıkça yazılmalıdır.
- Güncel fiyat doğrulanmadıysa kesin ücret verilmemeli; fiyatlandırmanın değişebileceği belirtilmelidir.
- Kullanıcının açık onayı olmadan ücretli API çağrısı, abonelik veya ödeme gerektiren entegrasyon başlatılmamalıdır.
- Yeni bir araç önermeden önce aynı işin mevcut araçlarla yapılıp yapılamayacağı değerlendirilmelidir.
- Mevcut aboneliklerin daha verimli kullanılması, yeni abonelik satın almaktan önce değerlendirilmelidir.

## Etsy Çalışma Odağı

- Kullanıcı şu anda özellikle Etsy modülünü geliştirmektedir.
- eRank verilerinin daha aktif ve verimli kullanılması önemlidir.
- eRank verileri yalnızca başlık ve etiket üretmek için değil, aşağıdaki alanlarda da değerlendirilebilir:
  - Fırsat puanlama
  - Anahtar kelime kümeleri
  - Ürün fikri doğrulama
  - Rekabet analizi
  - Sezonluk eğilimler
  - İçerik ve listeleme geliştirme
- eHunt veya benzeri araçlar önerildiğinde eRank ile tekrar eden özellikler ve sağlayacağı gerçek ek fayda açıkça karşılaştırılmalıdır.
- Mevcut eRank paketiyle yapılabilecekler değerlendirilmeden yeni ücretli bir Etsy aracı önerilmemelidir.
- Etsy çalışmalarında özellikle şu alanlar önemlidir:
  - Başlık optimizasyonu
  - Etiket optimizasyonu
  - Açıklama geliştirme
  - Ürün araştırması
  - Rakip analizi
  - Ana görsel ve diğer listeleme görselleri
  - Listeleme ve dönüşüm optimizasyonu

## Görsel Üretim ve Düzenleme

- Kullanıcının Canva Pro ve Gemini aboneliği vardır.
- Görsel üretim veya düzenleme önerilerinde önce Canva Pro ve mevcut Gemini imkânları değerlendirilmelidir.
- Projedeki mevcut görsel üretim entegrasyonu kararsız çalışmaktadır.
- Geçici Colab ve `loca.lt` bağlantılarının kalıcı üretim sistemi için güvenilir olmayabileceği dikkate alınmalıdır.
- Yeni bir görsel üretim servisi veya API önerildiğinde şu konular açıklanmalıdır:
  - Görsel başına veya aylık maliyet
  - Ücretsiz kullanım veya deneme kotası olup olmadığı
  - Ticari kullanım uygunluğu
  - Entegrasyon zorluğu
  - Düzenli bakım ihtiyacı
  - Vercel ile uyumluluğu
  - Mevcut Canva Pro ve Gemini araçlarıyla aynı işin yapılıp yapılamayacağı
- Ticari kullanım ve lisans koşulları doğrulanmadan kesin kabul edilmemelidir.
- Güncel maliyet veya kullanım limiti doğrulanmadıysa tahminde bulunulmamalıdır.

## Amazon Çalışma Odağı

- Kullanıcının Amazon araştırmaları için Helium 10 ve Keepa erişimi vardır.
- Amazon ile ilgili geliştirmelerde önce bu iki araçtan alınabilecek veriler değerlendirilmelidir.
- Aynı veya benzer verileri sağlayan ek ücretli araçlar, net bir üstünlük göstermeden önerilmemelidir.
- Amazon çalışmalarında özellikle şu alanlar önemlidir:
  - Ürün araştırması
  - Satış ve fiyat geçmişi
  - Rekabet analizi
  - Ürün ve kategori kısıtlamaları
  - Maliyet ve kârlılık analizi

## Araştırma ve Öneri Beklentisi

- Kullanıcı yalnızca istediği özelliğin yapılmasını değil, aynı görevle doğrudan ilgili daha verimli yöntemleri de öğrenmek ister.
- Codex uygun olduğunda şu açılardan geliştirme önerileri sunmalıdır:
  - Araç kullanımı
  - Veri kullanımı
  - İş akışı
  - Otomasyon
  - Güvenlik
  - Maliyet
  - Bakım kolaylığı
- Öneriler doğrudan mevcut görevle veya projenin amacıyla ilgili olmalıdır.
- Öneriler mevcut görevi habersizce değiştirmemeli veya kapsamını kendiliğinden genişletmemelidir.
- Alternatif yaklaşım ayrı olarak sunulmalı ve uygulamadan önce kullanıcının kararı beklenmelidir.
- Yeni agent, MCP, API, servis, otomasyon veya eklenti önerildiğinde fayda, maliyet, güvenlik, kurulum zorluğu, bakım ihtiyacı ve mevcut araçlarla alternatifleri açıklanmalıdır.
- Ücretsiz olduğu doğrulanmamış bir araç ücretsizmiş gibi sunulmamalıdır.
- Güncel internet araştırması yapılamıyorsa fiyat, özellik, kota, erişilebilirlik veya lisans durumu hakkında tahmin yürütülmemelidir.
- Güncel doğrulama gerektiği açıkça belirtilmelidir.
- Gereksiz araç, entegrasyon, abonelik veya mimari karmaşıklık önerilmemelidir.

## Öneri Sunma Biçimi

Önemli öneriler mümkün olduğunda aşağıdaki formatta sunulmalıdır:

- **Öneri:** Ne yapılması veya değerlendirilmesi öneriliyor?
- **Sağlayacağı fayda:** Projeye veya iş akışına somut katkısı nedir?
- **Mevcut araçlarla yapılabilir mi?:** Kullanıcının mevcut abonelikleri veya açık kaynak araçlar yeterli mi?
- **Maliyet durumu:** Ücretsiz mi, ücretli mi, yoksa güncel fiyat doğrulaması mı gerekiyor?
- **Kurulum zorluğu:** Kolay, orta veya zor; kullanıcıdan hangi işlemler bekleniyor?
- **Güvenlik ve bakım riski:** Hangi verilere erişir, hangi düzenli bakım gerekir?
- **Öncelik:** Şimdi gerekli, daha sonra değerlendirilebilir veya şimdilik gereksiz.

## Gizlilik

Bu dosyada hiçbir zaman aşağıdaki bilgiler saklanmamalıdır:

- Parolalar
- API anahtarları
- Erişim token’ları
- Supabase anahtar değerleri
- Gerçek Make.com webhook adresleri
- Özel servis veya tünel adresleri
- Oturum bilgileri
- Ödeme veya faturalandırma bilgileri
- Başka herhangi bir gizli ya da kimlik doğrulama değeri
