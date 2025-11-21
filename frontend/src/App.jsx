import React, { useState, useEffect } from "react";
import "./App.css";

// 🎯 API 函數區塊
const API_URL = "http://192.168.52.50:3174";

export async function fetchAllRecords() {
    const res = await fetch(`${API_URL}/records`);
    return res.json();
}

export async function fetchUnarchivedWeeks() {
    const res = await fetch(`${API_URL}/weeks/unarchived`);
    return res.json();
}

export async function fetchRecords(week) {
  const res = await fetch(`${API_URL}/records/${week}`);
  return res.json();
}

export async function addRecord(data) {
  const res = await fetch(`${API_URL}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updatePaidStatus(recordId, name, paid) {
  const res = await fetch(`${API_URL}/records/${recordId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, paid }),
  });
  return res.json();
}

export async function deleteRecord(recordId) {
  const res = await fetch(`${API_URL}/records/${recordId}`, {
    method: "DELETE",
  });
  return res.json();
}

export async function archiveRecords(week) {
    const res = await fetch(`${API_URL}/records/archive/${week}`, {
        method: "PATCH",
    });

    if (res.status === 400) {
        const error = await res.json();
        throw new Error(error.detail || "無法結算：本週尚有未付款紀錄。");
    }

    if (!res.ok) {
        throw new Error("結算失敗，伺服器錯誤。");
    }

    return res.json();
}

export default function App() {
  const [records, setRecords] = useState([]);
  const [unarchivedWeeks, setUnarchivedWeeks] = useState([]);
  const [allRecords, setAllRecords] = useState([]); 
  const [item, setItem] = useState("蛋");
  const [amount, setAmount] = useState("");
  const [buyer, setBuyer] = useState("");
  const [members, setMembers] = useState(["bee", "elsa", "jim", "betty"]); 
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  });
  const [showArchive, setShowArchive] = useState(false); 
  const [memberTotals, setMemberTotals] = useState({});
  const [debtRelations, setDebtRelations] = useState([]); // 🎯 新增：債務關係列表

  const currentWeek = `${startDate} ~ ${endDate}`;
  const BASE_WEEK_START = new Date("2025-10-20");

  const getRotation = () => {
    if (!members.length) return "";
    const current = new Date(startDate);
    const weekDiff = Math.floor((current - BASE_WEEK_START) / (7 * 24 * 60 * 60 * 1000));
    const index = weekDiff % members.length;
    return members[index];
  };

  const rotatingBuyer = getRotation();

  const loadUnarchivedWeeks = async () => {
    try {
      const weeks = await fetchUnarchivedWeeks();
      setUnarchivedWeeks(weeks);
    } catch (error) {
      console.error("Failed to fetch unarchived weeks:", error);
    }
  };

  const calculateTotals = (allRecords) => {
    // 建立一個二維債務關係表：debts[債務人][債權人] = 金額
    const debts = {};
    
    // 收集所有人
    const allPeople = new Set([
      ...members,
      ...allRecords.map(r => r.buyer),
      ...allRecords.flatMap(r => r.split_members.map(m => m.name))
    ]);

    // 初始化債務表
    allPeople.forEach(person => {
      debts[person] = {};
      allPeople.forEach(other => {
        if (person !== other) {
          debts[person][other] = 0;
        }
      });
    });

    // 計算每筆記錄的債務關係
    allRecords.forEach(record => {
      if (record.is_archived) return;

      const splitCount = record.split_members.length;
      if (splitCount === 0) return;

      const sharedAmount = record.amount / splitCount;

      record.split_members.forEach(m => {
        // 買方自己不欠自己錢
        if (m.name === record.buyer) return;
        
        // 如果已付款，不計入債務
        if (m.paid) return;

        // 記錄：m.name 欠 record.buyer 的錢
        debts[m.name][record.buyer] += sharedAmount;
      });
    });

    // 互相抵銷債務
    allPeople.forEach(personA => {
      allPeople.forEach(personB => {
        if (personA >= personB) return; // 只處理一次（A-B 配對）

        const aOwesB = debts[personA][personB];
        const bOwesA = debts[personB][personA];

        if (aOwesB > bOwesA) {
          // A 欠 B 比較多，抵銷後 A 還欠 B
          debts[personA][personB] = aOwesB - bOwesA;
          debts[personB][personA] = 0;
        } else if (bOwesA > aOwesB) {
          // B 欠 A 比較多，抵銷後 B 還欠 A
          debts[personB][personA] = bOwesA - aOwesB;
          debts[personA][personB] = 0;
        } else {
          // 兩邊相等，全部抵銷
          debts[personA][personB] = 0;
          debts[personB][personA] = 0;
        }
      });
    });

    // 轉換成顯示用的格式（只保留有債務的關係）
    const debtList = [];
    allPeople.forEach(debtor => {
      allPeople.forEach(creditor => {
        if (debtor !== creditor && debts[debtor][creditor] > 0.01) {
          debtList.push({
            debtor: debtor,
            creditor: creditor,
            amount: debts[debtor][creditor]
          });
        }
      });
    });

    // 同時計算每個人的淨額（用於原本的顯示）
    const totals = {};
    allPeople.forEach(name => totals[name] = 0);
    
    // 🎯 修正：基於抵銷後的債務關係計算淨額
    debtList.forEach(debt => {
      totals[debt.debtor] += debt.amount;   // 欠款者 +
      totals[debt.creditor] -= debt.amount; // 債權人 -
    });

    // 移除接近 0 的值
    Object.keys(totals).forEach(name => {
      if (Math.abs(totals[name]) < 0.01) delete totals[name];
    });

    console.log("最終淨額:", totals);
    console.log("債務清單:", debtList);

    setMemberTotals(totals);
    
    // 返回債務清單供其他地方使用
    return debtList;
  };

  const loadRecords = async () => {
    try {
      const data = await fetchRecords(currentWeek); 
      setRecords(data);
      return data; 
    } catch (error) {
      console.error("Failed to fetch current records:", error);
      return [];
    }
  };
  
  const loadAllRecords = async () => {
    try {
      const data = await fetchAllRecords();
      setAllRecords(data);

      // 只取未歸檔的紀錄，跨週累計
      const unarchivedRecords = data.filter(r => !r.is_archived);
      const debtList = calculateTotals(unarchivedRecords);
      setDebtRelations(debtList); // 🎯 儲存債務關係

      loadUnarchivedWeeks();
    } catch (error) {
      console.error("Failed to fetch all records:", error);
    }
  };

  useEffect(() => {
    loadRecords();
    loadAllRecords(); 
    loadUnarchivedWeeks();
  }, [currentWeek, members]); 

  const handleAddRecord = async () => {
    if (!amount || !buyer) {
      alert("請完整輸入金額與買方！");
      return;
    }
    if (selectedMembers.length === 0) {
      alert("請至少選擇一位共同分帳者！");
      return;
    }

    const newRecord = {
      week: currentWeek, 
      buyer,
      description: item || "無品項描述",
      amount: parseFloat(amount),
      split_members: selectedMembers.map((m) => ({
        name: m,
        paid: false,
      })),
    };

    const response = await addRecord(newRecord);

    if (response.status === "ok") {
      loadRecords();
      loadAllRecords(); 
      setAmount("");

      if (buyer && !members.includes(buyer)) {
        setMembers((prev) => [...prev, buyer]);
      }
    } else {
      alert("新增紀錄失敗！");
    }
  };

  const addMember = (newMember) => {
    if (newMember && !members.includes(newMember)) {
      setMembers([...members, newMember]);
      if (!buyer) {
        setBuyer(newMember);
      }
    }
  };

  const handleDeleteRecord = async (recordId, description) => {
    if (!window.confirm(`確定要刪除品項 "${description}" 的紀錄嗎？`)) {
      return;
    }
    
    const response = await deleteRecord(recordId);

    if (response.status === "deleted") {
      loadRecords();
      loadAllRecords(); 
    } else {
      alert("刪除紀錄失敗！");
    }
  };

  const handleTogglePaid = async (recordId, memberName, paidStatus) => {
    const updatedPaidStatus = !paidStatus;

    try {
      const response = await updatePaidStatus(recordId, memberName, updatedPaidStatus);
      
      if (response.status === "updated") {
        loadRecords(); 
        loadAllRecords(); 
      } else {
        alert("更新付款狀態失敗！");
      }
    } catch (error) {
      alert(error.message || "更新付款狀態失敗，可能紀錄已被歸檔。");
      loadRecords();
      loadAllRecords();
    }
  };

  const handleArchiveWeek = async () => {
    if (!window.confirm(`確定要結算並歸檔本週帳單 (${currentWeek}) 嗎？\n\n注意：結算後將無法修改付款狀態。`)) {
      return;
    }

    try {
      const response = await archiveRecords(currentWeek);
      if (response.status === "archived") {
        alert(`週次 ${currentWeek} 成功結算並歸檔！`);
        loadRecords(); 
        loadAllRecords();
        loadUnarchivedWeeks();
      }
    } catch (error) {
      alert(error.message || "結算失敗，請檢查是否所有紀錄都已付款。");
    }
  };

  // --- 歷史歸檔計算邏輯 ---
  const archivedWeeks = {};
  const manuallyArchivedRecords = allRecords.filter(r => r.is_archived);

  manuallyArchivedRecords.forEach(r => {
    if (!archivedWeeks[r.week]) {
      archivedWeeks[r.week] = [];
    }
    archivedWeeks[r.week].push(r);
  });
  
  const uniqueArchivedWeeks = archivedWeeks;
  const isCurrentWeekFullyPaid = records.length > 0 && records.every(r => r.split_members.every(m => m.paid));

  return (
    <div className="container">
      <div className="left-panel">
        <div className="header-row">
          <h1>💰 每週分帳日曆</h1>
          <div className="weekly-leader">
            🎯 本週負責人：<span>{rotatingBuyer}</span>
          </div>
        </div>
        <div className="date-picker">
          <div className="date-field">
            <label>開始：</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="date-field">
            <label>結束：</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        
        <div className="form-section">
          <select 
            className="buyer-select"
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            style={{ padding: '12px', fontSize: '18px', borderRadius: '8px', border: '1px solid #ccc' }}
          >
            <option value="" disabled>--- 選擇買方 ---</option>
            {[...new Set([...members, buyer])].filter(n => n).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          
          <input
            type="text"
            placeholder="品項"
            value={item}
            readOnly
          />
          <input
            type="number"
            placeholder="金額"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <div className="members">
            <label>
              共同分帳者：
              <button 
                type="button"
                onClick={() => {
                  if (selectedMembers.length === members.length) {
                    setSelectedMembers([]); // 如果全選了，就取消全選
                  } else {
                    setSelectedMembers([...members]); // 否則全選
                  }
                }}
                style={{
                  marginLeft: '10px',
                  padding: '4px 12px',
                  fontSize: '14px',
                  backgroundColor: selectedMembers.length === members.length ? '#f44336' : '#2196f3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {selectedMembers.length === members.length ? '取消全選' : '全選'}
              </button>
            </label>
            <div className="member-checkboxes">
              {members.map((m) => (
                <label key={m}>
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(m)}
                    onChange={() =>
                      setSelectedMembers((prev) =>
                        prev.includes(m)
                          ? prev.filter((x) => x !== m)
                          : [...prev, m]
                      )
                    }
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>

          <button className="add-btn" onClick={handleAddRecord}>
            ➕ 新增紀錄
          </button>
        </div>

        <div className="add-member">
          <input
            type="text"
            placeholder="輸入新成員名稱後按 Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addMember(e.target.value.trim());
                e.target.value = "";
              }
            }}
          />
        </div>
        <div className="unarchived-weeks-list">
          <h3>📝 待結清的週次</h3>
          {unarchivedWeeks.length === 0 ? (
            <p>目前沒有待結清的週次。</p>
          ) : (
            <ul>
              {unarchivedWeeks.map(week => (
                <li 
                  key={week} 
                  onClick={() => {
                    const [start, end] = week.split(' ~ ');
                    setStartDate(start);
                    setEndDate(end);
                  }}
                  className={week === currentWeek ? 'active-week' : ''}
                >
                  {week}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="right-panel">
        <div className="summary-section">
          <h3>📊 未結清總結</h3> 
          <div className="member-totals">
            {Object.keys(memberTotals).map(name => {
              const total = memberTotals[name];
              
              if (Math.abs(total) < 0.01) return null; 
              
              const displayTotal = Math.abs(total).toFixed(2);
              const isOwes = total > 0; 
              
              return (
                <div 
                  key={name} 
                  className={`member-total ${isOwes ? 'owes' : 'receives'}`} 
                >
                  <strong>{name}</strong>
                  {isOwes ? (
                    <span>未付: ${displayTotal}</span> 
                  ) : (
                    <span>未收: ${displayTotal}</span> 
                  )}
                </div>
              );
            })}
          </div>
          {Object.keys(memberTotals).every(name => Math.abs(memberTotals[name]) < 0.01) && (
            <p className="note" style={{ color: '#008000' }}>✨ 所有帳單目前都已付清！</p>
          )}
          
          {/* 🎯 新增：詳細債務關係 */}
          {debtRelations.length > 0 && (
            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed #ccc' }}>
              <h4 style={{ fontSize: '1em', color: '#555', marginBottom: '10px' }}>💳 結算明細</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {debtRelations.map((debt, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '10px 15px', 
                      backgroundColor: '#fff3e0', 
                      borderLeft: '4px solid #ff9800',
                      borderRadius: '4px',
                      fontSize: '0.95em'
                    }}
                  >
                    <strong style={{ color: '#e65100' }}>{debt.debtor}</strong> 欠 <strong style={{ color: '#1565c0' }}>{debt.creditor}</strong>：<span style={{ fontSize: '1.1em', fontWeight: 'bold' }}>${debt.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <p className="note">💡 <strong style={{color: '#b71c1c'}}>未付</strong>表示您欠款；<strong style={{color: '#2e7d32'}}>未收</strong>表示買家應收回墊付的錢。</p>
        </div>
        <hr />

        <h2>🗓 {currentWeek} 待結算紀錄</h2>
        
        {records.length > 0 && (
          <button 
            className="add-btn" 
            onClick={handleArchiveWeek}
            style={{ backgroundColor: isCurrentWeekFullyPaid ? '#0d47a1' : '#90caf9', cursor: isCurrentWeekFullyPaid ? 'pointer' : 'not-allowed' }}
            disabled={!isCurrentWeekFullyPaid}
          >
            {isCurrentWeekFullyPaid ? "✅ 確認結算本週帳單並歸檔" : "🔒 結算 (需全部付清)"}
          </button>
        )}
        <hr />

        {records.length === 0 ? (
          <p className="empty">本週已無待結算紀錄！</p>
        ) : (
          records.map((r) => {
            const splitAmount = r.split_members.length > 0 ? (r.amount / r.split_members.length).toFixed(2) : r.amount.toFixed(2);

            return (
              <div key={r.id} className="record"> 
                <div className="record-header">
                  <strong>{r.description}</strong> <span>💵 {r.amount} (分攤: ${splitAmount}/人)</span>
                  <button 
                    className="delete-btn"
                    onClick={() => handleDeleteRecord(r.id, r.description)}
                    title="刪除此筆紀錄"
                  >
                    🗑️
                  </button>
                </div>
                <p>買方：{r.buyer}</p>
                <div className="member-status">
                  {r.split_members.map((m) => ( 
                    <button
                      key={m.name}
                      className={m.paid ? "paid" : "unpaid"}
                      onClick={() => handleTogglePaid(r.id, m.name, m.paid)}
                    >
                      {m.name} {m.paid ? "✅" : "💸"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
        <hr />

        <button 
          className="archive-toggle-btn"
          onClick={() => setShowArchive(!showArchive)}
        >
          {showArchive ? "隱藏歷史歸檔" : "顯示歷史歸檔"} ({Object.keys(uniqueArchivedWeeks).length} 週)
        </button>
        
        {showArchive && (
          <div className="archive-section">
            <h3>📑 已結算歷史歸檔</h3>
            {Object.keys(uniqueArchivedWeeks).length === 0 ? (
              <p className="empty">目前沒有已結算的歷史紀錄。</p>
            ) : (
              Object.keys(uniqueArchivedWeeks).map(week => (
                <div key={week}>
                  <h4>📅 週次: {week}</h4>
                  {uniqueArchivedWeeks[week].map(r => (
                    <div key={r.id} className="archived-record record">
                      <div className="record-header">
                        <strong>{r.description}</strong> <span>💵 {r.amount}</span>
                      </div>
                      <p style={{marginTop: '0'}}>買方：{r.buyer}</p>
                    </div>
                  ))}
                </div>
              ))
            )}
            <hr />
          </div>
        )}
      </div>
    </div>
  );
}