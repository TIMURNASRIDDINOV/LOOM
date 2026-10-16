-- Preserve operator-entered translations. Populate the existing launch catalogue.
UPDATE products SET name_uz = CASE slug
  WHEN 'tshirt-regular' THEN 'Klassik futbolka'
  WHEN 'tshirt-oversized' THEN 'Oversayz futbolka'
  WHEN 'hoodie-regular' THEN 'Huddi'
  WHEN 'sweatshirt' THEN 'Svitshot'
  WHEN 'sweatpants' THEN 'Sport shimi'
  WHEN 'polo' THEN 'Polo ko‘ylak'
  WHEN 'cap' THEN 'Kepka'
END WHERE (name_uz IS NULL OR trim(name_uz) = '')
  AND slug IN ('tshirt-regular','tshirt-oversized','hoodie-regular','sweatshirt','sweatpants','polo','cap');
