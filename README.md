# DDD — Acoustic Sensor (PWA) + Fusion-seed backend

צומת אקוסטי של רשת DUCK DRONE DETECTION:
- **אפליקציית PWA** (גלאי אקוסטי) שניתנת להתקנה למסך-הבית בכל טלפון.
- **שרת Node** שמגיש את האפליקציה ואוסף דיווחי-זיהוי מכמה טלפונים (זרע שכבת ה-Fusion).

> ⚠️ אב-טיפוס מחקרי בלבד — לא מערכת התרעה מאומתת. אין להסתמך עליו להגנה בפועל.

---

## מה צריך להתקין פעם אחת
- **Node.js LTS** (כולל npm): https://nodejs.org  → התקן את גרסת ה-LTS.
- **Git**: https://git-scm.com/downloads
- חשבון **GitHub** (יש לך) וחשבון **Railway** (יש לך).

לבדיקה שהותקן (ב-CMD):
```
node -v
git --version
```

---

## שלב 1 — בדיקה מקומית (אופציונלי, מומלץ)
פתח CMD בתוך תיקיית הפרויקט (אחרי שחילצת את ה-zip), והרץ:
```
cd ddd-sensor
npm install
npm start
```
פתח בדפדפן: http://localhost:3000  → "התחל האזנה". (במחשב המיקרופון יעבוד מ-localhost.)
לעצירה: Ctrl+C.

---

## שלב 2 — העלאה ל-GitHub (CMD)
1. צור מאגר ריק ב-https://github.com/new בשם `ddd-sensor` (בלי README). העתק את הכתובת שמופיעה (https://github.com/<USERNAME>/ddd-sensor.git).
2. ב-CMD, בתוך תיקיית הפרויקט:
```
git init
git add .
git commit -m "DDD sensor MVP"
git branch -M main
git remote add origin https://github.com/<USERNAME>/ddd-sensor.git
git push -u origin main
```
(בפעם הראשונה Git יבקש להתחבר ל-GitHub — אשר בדפדפן.)

---

## שלב 3 — פריסה ל-Railway (קבלת לינק https חי)

### דרך א' — לוח הבקרה (הכי קל, בלחיצות)
1. https://railway.app → **New Project** → **Deploy from GitHub repo** → בחר `ddd-sensor`.
2. Railway יזהה Node ויבנה אוטומטית (מריץ `npm start`).
3. **Settings → Networking → Generate Domain**. תקבל כתובת כמו:
   `https://ddd-sensor-production.up.railway.app`

### דרך ב' — שורת פקודה (CMD)
```
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```
הפקודה האחרונה מדפיסה/יוצרת את כתובת ה-https שלך.

---

## שלב 4 — התקנה ובדיקה בטלפון
1. פתח את כתובת ה-Railway בטלפון.
2. תפריט הדפדפן → **הוסף למסך הבית** → עכשיו יש אייקון אפליקציה אמיתי.
3. פתח → "התחל האזנה" → אשר מיקרופון → בדוק מול רחפן/הקלטת רחפן.
4. כל זיהוי נשלח לשרת. בדיקת נתונים מצטברים:
   `https://<your-app>.up.railway.app/stats`  (כמה זוהו היום/החודש)
   `https://<your-app>.up.railway.app/reports` (500 האחרונים)

---

## הערות
- האחסון בשרת הוא **בזיכרון** ומתאפס בכל פריסה מחדש. כשנרצה התמדה — נחבר Postgres (Railway נותן בלחיצה).
- כל העיבוד האקוסטי מקומי במכשיר; נשלח רק וקטור-זיהוי קטן ואנונימי (No-PII, מזהה ארעי).
- HTTPS חובה כדי שהמיקרופון יעבוד בנייד — Railway נותן אוטומטית.

## הצעד הבא
Flutter — אפליקציית native לחנויות, על בסיס אותו גלאי. נבנה אחרי שה-PWA אוסף דאטה.
