# AGENTS.md

## İletişim

- Kullanıcı yazılımcı değildir. Yapılacak işlemleri, alınan kararları ve sonuçları sade Türkçe ile açıkla.
- Teknik terim gerektiğinde kısa ve anlaşılır bir açıklama ekle.
- Başarısız testleri, hataları, eksik bilgileri ve belirsizlikleri gizleme.
- Doğrulanmamış bir sonucu başarılı olmuş gibi sunma.
- Vercel deployment sonucunu gerçekten göremiyorsan deployment’ın başarılı olduğunu iddia etme.

## Görev Kapsamı

- Yalnızca kullanıcının istediği görevi yerine getir.
- Görev dışındaki dosyalarda gereksiz değişiklik veya genel refactor yapma.
- Çalışan özellikleri zorunlu olmadıkça yeniden yazma.
- Mevcut kullanıcı değişikliklerini koru ve ilgisiz değişikliklere dokunma.
- `index.html` büyük ve hassastır. Bu dosyada yalnızca görev için gerekli olan bölümlere, mümkün olan en küçük değişiklikle dokun.
- Büyük, riskli veya birden fazla sistemi etkileyen değişikliklerden önce sade Türkçe bir uygulama planı hazırla ve kullanıcıyla paylaş.
- Görev sırasında önemli yeni bir mimari karar alınırsa bunu `AGENTS.md` dosyasına veya uygun proje dokümantasyonuna eklemeyi öner. Açık görev kapsamı dışında dokümantasyonu kendiliğinden değiştirme.

## Araştırma ve Öneri

- Kullanıcının yalnızca verilen görevin uygulanmasını değil, projeyi daha iyi ve daha verimli hale getirebilecek alternatifler hakkında öneri de beklediğini dikkate al.
- Bir özellik geliştirilirken mevcut sistemin, verilerin veya araçların daha etkili kullanılabileceği açık bir yöntem fark edilirse bunu ayrıca belirt.
- Önerileri doğrudan görevle ve projenin amacıyla ilişkili tut. Gereksiz araç, entegrasyon, servis veya mimari karmaşıklık önerme.
- Öncelikle ücretsiz, açık kaynaklı veya kullanıcının zaten sahip olduğu araç ve aboneliklerle uygulanabilecek çözümleri araştır.
- Kullanıcının mevcut araçlarını, aboneliklerini ve kurulu entegrasyonlarını dikkate alarak mümkün olduğunca mevcut imkânlardan yararlan.
- Ücretli bir araç veya hizmet önerilecekse ücretsiz olmadığını açıkça belirt.
- Güncel fiyat doğrulanmadıysa kesin ücret rakamı verme. Fiyatlandırmanın değişebileceğini ve güncel fiyatın resmi kaynaktan doğrulanması gerektiğini belirt.
- Kullanıcı açıkça onaylamadan ücretli bir hizmete kayıt olma, ücretli API çağrısı oluşturma, abonelik başlatma veya ödeme gerektiren entegrasyon kurma.
- Ücretsiz olduğu güncel ve güvenilir bir kaynaktan doğrulanmayan MCP, API, servis, eklenti veya aracı ücretsizmiş gibi sunma.
- İnternette güncel araştırma yapma yetkisi veya erişimi yoksa güncel fiyat, özellik, kota, erişilebilirlik ya da lisans durumu hakkında tahmin yürütme. Güncel araştırma erişimi gerektiğini açıkça belirt.
- Kullanıcıya yalnızca teknik kod çözümleri değil; iş akışı, veri kullanımı, otomasyon, araştırma, güvenlik, bakım ve maliyet açısından geliştirme fırsatlarını da bildir.
- Önerileri uygun olduğunda şu önceliklerle sınıflandır:
  - **Şimdi gerekli:** Güvenlik, veri kaybı, çalışan sistemi bozma veya yakın vadeli geliştirme açısından öncelikli konular.
  - **Daha sonra değerlendirilebilir:** Faydalı olan ancak mevcut görev için zorunlu olmayan geliştirmeler.
  - **Şimdilik gereksiz:** Mevcut ölçek ve ihtiyaç için ek maliyet veya gereksiz karmaşıklık oluşturacak çözümler.
- Bir geliştirme sırasında daha iyi bir yaklaşım fark edilirse mevcut görevi habersizce değiştirme veya kapsamı genişletme. Öneriyi ayrı olarak sun, mevcut yaklaşımla farkını açıkla ve kullanıcının kararını bekle.
- Bir öneri mevcut görevi engellemiyorsa görev kapsamındaki işi tamamla; öneriyi görev sonu özetinde ayrıca belirt.
- Öneri güvenlik, veri kaybı, ücret veya geri dönüşü zor bir işlemle ilgiliyse uygulamadan önce kullanıcıyı bilgilendir ve açık kararını bekle.

### Yeni araç ve entegrasyon önerileri

Yeni bir agent, MCP, API, servis, eklenti veya otomasyon önerilecekse aşağıdaki bilgileri sade Türkçe ile açıkla:

1. Ne işe yaradığı
2. Bu projeye sağlayacağı somut fayda
3. Ücretsiz olup olmadığı veya ücret durumunun doğrulanıp doğrulanmadığı
4. Güvenlik ve gizlilik riskleri
5. Kurulum ve bakım zorluğu
6. Mevcut araçlarla aynı işin yapılıp yapılamayacağı

Bu değerlendirme yapılmadan kullanıcıya yeni araç kurulması veya yeni entegrasyon eklenmesi önerisinde bulunma.

## Git ve Deployment

- Kullanıcı açıkça istemeden commit oluşturma.
- Kullanıcı açıkça istemeden GitHub’a push yapma.
- Commit veya push istendiğinde önce değişiklikleri ve kontrollerin sonucunu özetle.
- Push yapılmasının Vercel’de otomatik deployment başlatabileceğini hesaba kat.
- Vercel deployment durumunu doğrudan doğrulayamıyorsan yalnızca push işleminin tamamlandığını belirt; deployment’ın başarılı olduğunu söyleme.

## Supabase ve Canlı Veri Güvenliği

- Kullanıcının açık onayı olmadan Supabase tablolarını veya kolonlarını oluşturma, değiştirme ya da silme.
- Kullanıcının açık onayı olmadan canlı verileri toplu olarak güncelleme veya silme.
- Veri silme, migration veya geri dönüşü zor veritabanı işlemlerinden önce etkilenecek alanları ve riski açıkla.
- Mümkün olduğunda canlı sistem yerine test veya preview ortamını kullanmayı öner.
- `test_delete.py` dosyasını hiçbir koşulda çalıştırma. Bu dosyanın canlı Supabase kayıtlarını silebileceğini varsay.

## Entegrasyonlar ve Gizli Bilgiler

- Make.com webhook adreslerini ve diğer harici entegrasyon adreslerini kullanıcının açık onayı olmadan değiştirme.
- Mevcut API, webhook, Supabase, Gemini veya Colab bağlantılarının davranışını değiştirecek işlemlerden önce etkisini açıkla.
- API anahtarlarını, parolaları, token’ları, webhook adreslerinin gizli bölümlerini veya environment variable değerlerini dosyalara, loglara, commit mesajlarına ya da kullanıcı yanıtlarına yazma.
- Gizli değerleri kullanıcıdan isteme. Yalnızca gerekli environment variable isimlerini belirt.
- Gizli bir değer yanlışlıkla açığa çıkmış görünüyorsa değeri tekrar gösterme; yalnızca konumunu ve yenilenmesi gerektiğini bildir.

## Bağımlılıklar

- Yeni bir bağımlılık eklemeden önce neden gerekli olduğunu, hangi sorunu çözdüğünü ve mevcut araçlarla çözülemeyip çözülemeyeceğini sade Türkçe ile açıkla.
- Yeni bağımlılık için kullanıcı onayı gerekiyorsa uygulamadan önce onay al.
- Mevcut bağımlılık sürümlerini veya çalışma zamanını gereksiz yere yükseltme.
- Bağımlılık değişikliklerinin Vercel deployment boyutu, çalışma süresi ve uyumluluk üzerindeki etkisini değerlendir.

## Kontrol ve Test

- Her değişiklikten sonra değişikliğin riskine uygun kontrolleri çalıştır.
- Önce güvenli ve salt okunur kontrolleri tercih et.
- Canlı Supabase verisini değiştiren, ücretli API çağrısı yapan veya dış otomasyon başlatan testleri açık onay olmadan çalıştırma.
- Testlerin hangi ortamda çalıştığını belirt.
- Bir kontrol çalıştırılamadıysa nedenini açıkça yaz.
- Başarısız testleri atlama veya başarılı gibi gösterme.
- Yerel sunucunun Vercel ortamını tam olarak taklit etmediğini hesaba kat.
- Kontroller sırasında oluşturulan geçici veya derleme dosyalarının yanlışlıkla Git’e eklenmediğini doğrula.

## Görev Sonu Özeti

Her görev sonunda sade Türkçe olarak şunları özetle:

- Değiştirilen dosyalar
- Her dosyada yapılan işlemler
- Çalıştırılan test ve kontroller
- Testlerin sonucu
- Çalıştırılamayan veya doğrulanamayan kontroller
- Bilinen riskler ve belirsizlikler
- Commit, push veya deployment yapılıp yapılmadığı
- Kullanıcının bilmesi gereken güvenli sonraki adım
- Varsa doğrudan görevle ilgili araştırma ve geliştirme önerileri
