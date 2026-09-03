CREATE POLICY "partner-attachments read"   ON storage.objects FOR SELECT TO public USING (bucket_id = 'partner-attachments');
CREATE POLICY "partner-attachments insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'partner-attachments');
CREATE POLICY "partner-attachments update" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'partner-attachments');
CREATE POLICY "partner-attachments delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'partner-attachments');