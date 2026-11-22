# ร่วมพัฒนา Beholder

1. กด **Fork** บน GitHub แล้ว clone fork ลงเครื่อง
2. สร้าง branch จาก `main` สำหรับสิ่งที่จะแก้ เช่น `fix/token-drag`
3. เปิดแอปผ่าน Docker ตาม [README](README.md) ใช้ `pnpm check`, `pnpm build` และ `pnpm test` เพื่อตรวจงาน ถ้าแก้การเล่นหลายคน ให้ลองด้วย DM และผู้เล่นคนละเซสชัน หรือใช้ `pnpm test:browser`
4. Push branch ขึ้น fork แล้วเปิด Pull Request เข้า `main` ของ [Beholder Project](https://github.com/posawatwichitsaro-bit/Beholder-Project)
5. ใน PR ระบุสิ่งที่เปลี่ยน วิธีทดสอบ และผลที่ได้ ถ้าแก้หน้าจอให้แนบภาพที่ใช้ข้อมูลสำหรับทดสอบ

ใช้แผนที่ ภาพ Token และข้อมูลเกมที่คุณมีสิทธิ์เผยแพร่ เก็บคุกกี้ ลิงก์เชิญห้องจริง และไฟล์ตั้งค่าที่มีข้อมูลส่วนตัวไว้ในเครื่อง
