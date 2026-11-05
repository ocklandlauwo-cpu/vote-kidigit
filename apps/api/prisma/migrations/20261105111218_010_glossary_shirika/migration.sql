-- 010_glossary_shirika. Runs as vk_owner. No schema change: the Swahili permission descriptions
-- of 008 said "taasisi" for organization; the glossary (Design System 11.6) uses "Shirika"
-- consistently. Migration 008 is applied, so it is corrected here instead of edited.

-- Hand-written below this line

UPDATE public.permissions SET description_sw = 'Wasifu wa shirika, chapa, saa za eneo, mtumaji wa SMS na violezo vya msingi'
WHERE key = 'org.settings.manage';
UPDATE public.permissions SET description_sw = 'Kuona na kupakua kumbukumbu za ukaguzi za shirika'
WHERE key = 'audit.view.org';
UPDATE public.permissions SET description_sw = 'Kuunda, kuhariri na kusimamisha mashirika'
WHERE key = 'platform.orgs.manage';
