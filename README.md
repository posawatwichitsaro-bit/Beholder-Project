# Beholder-Project

เว็บกระดาน D&D สำหรับกลุ่มเพื่อน ใช้กติกาพื้นฐานฉบับปรับปรุงปี 2024 และแนวทางจาก [SRD 5.2.1](https://www.dndbeyond.com/srd)

ร่วมพัฒนาด้วยการ fork แล้วส่ง Pull Request ตาม [คู่มือร่วมพัฒนา](CONTRIBUTING.md)

## สัญญาอนุญาตและที่มา

โค้ดของ Beholder ใช้ [MIT License](LICENSE) เนื้อหาที่มาจาก SRD อยู่ภายใต้ CC BY 4.0 ตามข้อความเครดิตด้านล่าง

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at [D&D Beyond](https://www.dndbeyond.com/srd). The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode).

## เปิดโต๊ะ

เปิด Docker Desktop แล้วรันคำสั่งจากโฟลเดอร์นี้

```sh
docker compose up --build --detach --wait
```

เปิด [Beholder บนเครื่องนี้](http://127.0.0.1:3000/) ตั้งชื่อห้องและชื่อ DM แล้วสร้างห้อง เปิดเมนู **เชิญผู้เล่น** เพื่อคัดลอกลิงก์ ทดสอบหลายบทบาทบนเครื่องเดียวกันโดยใช้เบราว์เซอร์คนละโปรไฟล์หรือหน้าต่างส่วนตัว เพื่อให้แต่ละที่นั่งมีคุกกี้ของตัวเอง

สำหรับกลุ่มที่อยู่บนเครือข่ายเดียวกัน ตั้งค่า `BEHOLDER_BIND=0.0.0.0` ในไฟล์ `.env` ข้าง Compose แล้วเปิดเว็บด้วย IP ของเครื่องที่รัน Docker ก่อนกดคัดลอกลิงก์ ลิงก์เชิญจะใช้ที่อยู่เดียวกับหน้าเว็บ ค่าตั้งต้นเปิดให้เข้าจากเครื่องที่รัน Docker เท่านั้น

DM สร้างฉาก อัปโหลดแผนที่ PNG/JPEG/WebP แล้วตั้งขนาดช่องและจุดกำเนิด Grid ผู้เล่นสร้างชีตของตนเอง แล้ว DM กด **วาง** ข้างชีตหรือต้นแบบมอนสเตอร์และคลิกช่องบนแผนที่ ใช้ **เปิดให้ผู้เล่น** เพื่อสลับฉากของทั้งโต๊ะ

ระหว่างต่อสู้ให้ DM เลือกผู้ร่วมและทอย Initiative การโจมตีที่โดนสร้างผลทอยความเสียหายให้ DM ยืนยัน HP สำหรับเวทที่ให้เป้าหมายทอย Save ให้เลือกลูกเต๋าความเสียหาย ค่าความสามารถ และเป้าหมายจากชีตผู้ร่าย แล้วให้ผู้ควบคุมเป้าหมายทอยจากรายการผลทอย การใช้ช่องเวทและผลเฉพาะให้แก้จากชีตตามที่โต๊ะตกลง

เปิดห้องเดิมจาก URL ห้องและโปรไฟล์เบราว์เซอร์เดิม ข้อมูล PostgreSQL และไฟล์แผนที่อยู่ใน Docker volumes `database` และ `maps` ใช้ `docker compose stop` เพื่อหยุดบริการโดยเก็บข้อมูลไว้ และใช้ `docker compose start` เพื่อกลับมาเล่นต่อ

## ตรวจสอบโค้ดและรอบการเล่น

ใช้ Node.js 24 และ pnpm ตามเวอร์ชันใน `package.json`

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

ชุดทดสอบ API ใช้ PostgreSQL แบบฝังเป็นค่าเริ่มต้น ตั้ง `BEHOLDER_TEST_URL=http://127.0.0.1:3000` เพื่อรันกับแอปจริงบน Docker โดยชุดทดสอบจะสร้างห้องเฉพาะของตัวเอง

ตั้ง `BEHOLDER_TEST_RESTART=1` เพิ่มเมื่อต้องการให้ชุดทดสอบรีสตาร์ตบริการ Compose ชุดนี้แล้วตรวจข้อมูลและแผนที่ที่บันทึกไว้ ให้รันก่อนเปิดโต๊ะจริงเพื่อไม่ให้เกมหยุดระหว่างเล่น

`pnpm test:browser` เปิด Microsoft Edge แบบ headless และจำลองสามที่นั่งกับแอปที่กำลังรัน ตั้ง `BEHOLDER_BROWSER` เป็นตำแหน่งไฟล์ของ Chrome หรือ Chromium หากเครื่องใช้เบราว์เซอร์อื่น
