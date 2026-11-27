-- eco.alert（網站巡檢警報）要帶網站名稱、掛了／恢復、簡短備註；不含個資。其他事件此欄為空。
ALTER TABLE webhook_events ADD COLUMN detail TEXT;
