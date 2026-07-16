-- billing_016_drop_item_group
-- billing_items.group_name was a leftover from the pricing-groups concept that was
-- removed early in v2. Nothing reads it: the pricing engine ignores it entirely, and it
-- only survived as a free-text box on the item form plus a column in the list. It had no
-- data (0 of 4 items set it), so it was a field asking to be filled in for no reason.
--
-- Item CATEGORY is what actually classifies an item now (see billing_011).

ALTER TABLE billing_items DROP COLUMN group_name;
