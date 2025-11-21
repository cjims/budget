# main.py (FastAPI Backend)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import json
import uvicorn

app = FastAPI()
# 跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "database.db"

@app.on_event("startup")
def init_db():
    print(">>> [Startup Event] 正在執行 init_db()...")
    try:
        with sqlite3.connect(DB_PATH) as conn:
            # 確保 records 表格存在
            conn.execute("""
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week TEXT NOT NULL,
    buyer TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    split_members TEXT,
    is_archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP 
    -- created_at 欄位用於計算時間，儲存格式如 '2025-10-31 16:00:00'
)
""")
            print(">>> 資料庫初始化完成，records 表格已確保存在。")
            
            # 刪除超過 30 天的已歸檔紀錄
            delete_query = """
            DELETE FROM records 
            WHERE is_archived = 1 
              AND created_at < DATETIME('now', '-30 days')
            """
            cursor = conn.execute(delete_query)
            conn.commit()
            print(f">>> 執行清理：已刪除 {cursor.rowcount} 筆超過 30 天的已歸檔紀錄。")
            
    except Exception as e:
        print(f"!!! [Startup Error] 初始化資料庫失敗: {e}")

class Record(BaseModel):
    week: str 
    buyer: str
    description: str
    amount: float
    split_members: list[dict]

# 結算週次紀錄
@app.patch("/records/archive/{week}")
def archive_records(week: str):
    with sqlite3.connect(DB_PATH) as conn:
        # 檢查該週是否所有紀錄都已付款
        rows = conn.execute("SELECT split_members FROM records WHERE week=?", (week,)).fetchall()
        
        if not rows:
             raise HTTPException(404, detail=f"No records found for week {week}")

        # 檢查所有人是否都已付錢
        all_paid = True
        for row in rows:
            members = json.loads(row[0])
            for m in members:
                if not m.get("paid"):
                    all_paid = False
                    break
            if not all_paid:
                break
        
        if not all_paid:
             raise HTTPException(400, detail="Cannot archive: Not all split members have paid for all records this week.")


        # 所有人都付款，該週所有紀錄標記為已歸檔
        conn.execute("UPDATE records SET is_archived = 1 WHERE week=?", (week,))
        conn.commit()
    return {"status": "archived", "week": week}

# 將資料庫row轉換為字典，傳回前端
def record_row_to_dict(r):
    return {
        "id": r[0],
        "week": r[1],
        "buyer": r[2],
        "description": r[3],
        "amount": r[4],
        "split_members": json.loads(r[5]),
        "is_archived": bool(r[6]),
        "created_at": r[7]
    }

# post:新增紀錄
@app.post("/records")
def add_record(record: Record):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO records (week, buyer, description, amount, split_members, is_archived) VALUES (?, ?, ?, ?, ?, ?)",
            (record.week, record.buyer, record.description, record.amount, json.dumps(record.split_members), 0)
    )
    return {"status": "ok"}

# get:所有紀錄(週次倒序)
@app.get("/records")
def get_all_records():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM records ORDER BY week DESC").fetchall() 
    return [record_row_to_dict(r) for r in rows] 

# get:某一週的未結算紀錄
@app.get("/records/{week}")
def get_records(week: str):
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT * FROM records WHERE week=? AND is_archived = 0", (week,)).fetchall() 
    return [record_row_to_dict(r) for r in rows]

# 刪除紀錄
@app.delete("/records/{record_id}")
def delete_record(record_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM records WHERE id=?", (record_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Record not found")
    return {"status": "deleted"}

# get:所有未結算週
@app.get("/weeks/unarchived")
def get_unarchived_weeks():
    with sqlite3.connect(DB_PATH) as conn:
        # 查詢所有is_archived = 0的紀錄，並分組取得不重複的倒序week
        rows = conn.execute("SELECT DISTINCT week FROM records WHERE is_archived = 0 ORDER BY week DESC").fetchall()
    return [row[0] for row in rows]

# patch:更新某紀錄的成員付款狀態
@app.patch("/records/{record_id}")
def update_paid_status(record_id: int, data: dict):
    with sqlite3.connect(DB_PATH) as conn:
        
        # 獲取is_archived狀態
        row = conn.execute("SELECT split_members, is_archived FROM records WHERE id=?", (record_id,)).fetchone() 

        if not row:
            raise HTTPException(404, "Record not found")
        
        if row[1] == 1:
             raise HTTPException(400, detail="Cannot change paid status: this record is already archived.")

        members = json.loads(row[0])

        for m in members:
            if m["name"] == data["name"]:
                m["paid"] = data["paid"]

        conn.execute("UPDATE records SET split_members=? WHERE id=?", (json.dumps(members), record_id))

    return {"status": "updated"}

if __name__ == "__main__":

    uvicorn.run(app, host="0.0.0.0", port=3174, log_level="info")