UPDATE `artifact_installations`
SET `item_id` = NULL, `source_id` = NULL
WHERE `source_id` = 'catalog-mcp-so'
   OR `item_id` IN (
     SELECT `id` FROM `catalog_items` WHERE `source_id` = 'catalog-mcp-so'
   );
--> statement-breakpoint
DELETE FROM `catalog_items` WHERE `source_id` = 'catalog-mcp-so';
--> statement-breakpoint
DELETE FROM `catalog_sources` WHERE `id` = 'catalog-mcp-so';
