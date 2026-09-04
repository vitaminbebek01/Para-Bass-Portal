-- Etsy eRank CSV kaynak mağazasını kaydetmek için güvenli, geri uyumlu ek alan.
alter table public.erank_keywords add column if not exists shop_name text;
