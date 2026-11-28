# เปิดโต๊ะให้เพื่อนเล่นผ่านอินเทอร์เน็ต (Tailscale Funnel · ฟรี)

ใช้ Tailscale ตัวที่สองที่รันใน Docker แยกจาก Tailscale ที่ติดตั้งบน Windows (ของที่ทำงานใช้ต่อได้ตามเดิม)

## ตั้งครั้งแรก

1. สมัคร Tailscale บัญชีส่วนตัว แล้วสร้าง Auth key ที่ Admin › Settings › Keys
2. ในหน้า Admin › DNS กด **Enable HTTPS** (Funnel ต้องใช้ใบรับรอง)
3. สร้างไฟล์ `.env` ข้าง `compose.yaml` (ไฟล์นี้ไม่เข้า git):

   ```
   TS_AUTHKEY=tskey-...
   BEHOLDER_PUBLIC_ORIGIN=https://beholder.<tailnet>.ts.net
   ```

4. เปิดทั้งชุด:

   ```powershell
   docker compose -p project --profile tailscale up -d --build --wait
   docker compose -p project exec tailscale tailscale funnel status
   ```

## ใช้งาน

- ทุกคน (รวม DM) เปิด `https://beholder.<tailnet>.ts.net` แล้วคัดลอกลิงก์เชิญจากหน้านั้น
- เมื่อตั้ง `BEHOLDER_PUBLIC_ORIGIN` แล้ว การเข้าทาง `http://localhost:3000` จะโดนปฏิเสธ (Origin ไม่ตรง)
- ทุก service ตั้ง `restart: unless-stopped` จึงกลับมาเองหลังรีบูต ถ้า Docker Desktop เปิดตอน login
- สำรองข้อมูล: `powershell -File scripts\backup.ps1` ได้ `backups\<วันที่>\beholder.sql` และ `maps.tar`
- หยุด: `docker compose -p project --profile tailscale stop` (ห้าม `down -v`)
