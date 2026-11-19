/** A real playable board, used to verify browser acceptance independently of model output. */
export const TIC_TAC_TOE = `import { useState } from "react";
export default function App() {
 const [board,setBoard]=useState(Array(9).fill(""));
 const [turn,setTurn]=useState("X");
 const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
 const line=lines.find(([a,b,c])=>board[a] && board[a]===board[b] && board[a]===board[c]);
 const winner=line ? board[line[0]] : null;
 const draw=!winner && board.every(Boolean);
 const move=(n)=>{if(board[n]||winner||draw)return;const next=[...board];next[n]=turn;setBoard(next);setTurn(turn==="X"?"O":"X");};
 return <main><h1>Local/demo Tic-tac-toe</h1><p data-gb-status>{winner ? winner+" wins" : draw ? "Draw" : turn+" turn"}</p>
 <div>{board.map((v,n)=><button key={n} data-gb-cell={n} style={{width:48,height:48}} aria-label={"Cell "+(n+1)} disabled={Boolean(v||winner||draw)} onClick={()=>move(n)}>{v}</button>)}</div>
 <button data-gb-restart onClick={()=>{setBoard(Array(9).fill(""));setTurn("X");}}>Restart</button></main>;
}`;
