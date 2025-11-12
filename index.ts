export type Square = number;

export enum Color {
  White = 'w',
  Black = 'b',
}

export enum PieceType {
  Pawn = 'p',
  Knight = 'n',
  Bishop = 'b',
  Rook = 'r',
  Queen = 'q',
  King = 'k',
}

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: PieceType;
  captured?: Piece | null;
  isEnPassant?: boolean;
  isCastling?: boolean;
}

const DIRS = {
  knight: [-17, -15, -10, -6, 6, 10, 15, 17],
  bishop: [-9, -7, 7, 9],
  rook: [-8, -1, 1, 8],
  king: [-9, -8, -7, -1, 1, 7, 8, 9],
};

function rankOf(s: Square) { return Math.floor(s / 8); }
function fileOf(s: Square) { return s % 8; }
function onBoard(s: number) { return s >= 0 && s < 64; }

export class Board {
  squares: Array<Piece | null> = new Array(64).fill(null);

  constructor(fen?: string) {
    if (fen) this.loadFEN(fen);
    else this.reset();
  }

  reset() {
    const startFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.loadFEN(startFEN);
  }

  get(square: Square) { return this.squares[square]; }
  set(square: Square, piece: Piece | null) { this.squares[square] = piece; }

  clone(): Board {
    const b = new Board();
    b.squares = this.squares.map(p => p ? { ...p } : null);
    return b;
  }

  loadFEN(fen: string) {
    // minimal FEN parser for piece placement and active color and castling & en-passant
    const parts = fen.split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN');
    this.squares.fill(null);
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) {
          file += parseInt(ch, 10);
        } else {
          const color = ch === ch.toUpperCase() ? Color.White : Color.Black;
          const type = (ch.toLowerCase() as PieceType);
          const sq = (7 - r) * 8 + file;
          this.squares[sq] = { type, color };
          file++;
        }
      }
    }
  }

  exportFEN(active: Color, castling: string, ep: string, halfmove = 0, fullmove = 1) {
    let rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      let row = '';
      for (let f = 0; f < 8; f++) {
        const sq = r * 8 + f;
        const p = this.squares[sq];
        if (!p) { empty++; }
        else {
          if (empty) { row += String(empty); empty = 0; }
          const ch = p.type;
          row += p.color === Color.White ? ch.toUpperCase() : ch;
        }
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return `${rows.join('/') } ${active} ${castling} ${ep} ${halfmove} ${fullmove}`;
  }
}

export class Game {
  board: Board;
  activeColor: Color = Color.White;
  castlingRights = { K: true, Q: true, k: true, q: true };
  enPassantSquare: Square | null = null;
  halfmoveClock = 0;
  fullmoveNumber = 1;
  history: Move[] = [];

  constructor(fen?: string) {
    this.board = new Board(fen);
  }

  isSquareAttacked(sq: Square, byColor: Color): boolean {
    const r = rankOf(sq), f = fileOf(sq);
    const dir = byColor === Color.White ? 1 : -1;
    const attackers: number[] = [];
    const p1 = sq - 8*dir - 1;
    const pawnOffsets = byColor === Color.White ? [-7, -9] : [7, 9];
    for (const off of pawnOffsets) {
      const s = sq + off;
      if (!onBoard(s)) continue;
      const pf = fileOf(s);
      if (Math.abs(pf - f) !== 1) continue;
      const p = this.board.get(s);
      if (p && p.type === PieceType.Pawn && p.color === byColor) return true;
    }

    for (const off of DIRS.knight) {
      const s = sq + off;
      if (!onBoard(s)) continue;
      if (Math.abs(fileOf(s) - f) > 2) continue;
      const p = this.board.get(s);
      if (p && p.type === PieceType.Knight && p.color === byColor) return true;
    }

    for (const off of DIRS.bishop) {
      let s = sq + off;
      while (onBoard(s) && Math.abs(fileOf(s) - fileOf(s - off)) === 1) {
        const p = this.board.get(s);
        if (p) { if ((p.type === PieceType.Bishop || p.type === PieceType.Queen) && p.color === byColor) return true; break; }
        s += off;
      }
    }
    for (const off of DIRS.rook) {
      let s = sq + off;
      while (onBoard(s) && Math.abs(fileOf(s) - fileOf(s - off)) <= 1) {
        const p = this.board.get(s);
        if (p) { if ((p.type === PieceType.Rook || p.type === PieceType.Queen) && p.color === byColor) return true; break; }
        s += off;
      }
    }

    for (const off of DIRS.king) {
      const s = sq + off;
      if (!onBoard(s)) continue;
      if (Math.abs(fileOf(s) - f) > 1) continue;
      const p = this.board.get(s);
      if (p && p.type === PieceType.King && p.color === byColor) return true;
    }

    return false;
  }

  findKing(color: Color): Square {
    for (let s = 0; s < 64; s++) {
      const p = this.board.get(s);
      if (p && p.type === PieceType.King && p.color === color) return s;
    }
    throw new Error('King not found');
  }

  isInCheck(color: Color): boolean {
    const kingSq = this.findKing(color);
    return this.isSquareAttacked(kingSq, color === Color.White ? Color.Black : Color.White);
  }

  generateMovesFor(square: Square): Move[] {
    const p = this.board.get(square);
    if (!p) return [];
    if (p.color !== this.activeColor) return [];
    const moves: Move[] = [];
    const r = rankOf(square), f = fileOf(square);

    const pushMove = (to: Square, extras: Partial<Move> = {}) => {
      moves.push({ from: square, to, captured: this.board.get(to), ...extras } as Move);
    };

    switch (p.type) {
      case PieceType.Pawn: {
        const dir = p.color === Color.White ? 1 : -1;
        const forward = square + dir * 8;
        if (onBoard(forward) && !this.board.get(forward)) {
          const targetRank = rankOf(forward);
          if (targetRank === 7 || targetRank === 0) {
            pushMove(forward, { promotion: PieceType.Queen });
            pushMove(forward, { promotion: PieceType.Rook });
            pushMove(forward, { promotion: PieceType.Bishop });
            pushMove(forward, { promotion: PieceType.Knight });
          } else pushMove(forward);

          const startRank = p.color === Color.White ? 1 : 6;
          const two = square + dir * 16;
          if (rankOf(square) === startRank && !this.board.get(two)) pushMove(two);
        }
        for (const dx of [-1, 1]) {
          const file = fileOf(square) + dx;
          if (file < 0 || file > 7) continue;
          const to = square + dir * 8 + dx;
          if (!onBoard(to)) continue;
          const target = this.board.get(to);
          if (target && target.color !== p.color) {
            const tr = rankOf(to);
            if (tr === 7 || tr === 0) {
              pushMove(to, { promotion: PieceType.Queen, captured: target });
              pushMove(to, { promotion: PieceType.Rook, captured: target });
              pushMove(to, { promotion: PieceType.Bishop, captured: target });
              pushMove(to, { promotion: PieceType.Knight, captured: target });
            } else pushMove(to, { captured: target });
          }
          if (this.enPassantSquare !== null && to === this.enPassantSquare) {
            pushMove(to, { isEnPassant: true, captured: { type: PieceType.Pawn, color: p.color === Color.White ? Color.Black : Color.White } });
          }
        }
        break;
      }

      case PieceType.Knight: {
        for (const off of DIRS.knight) {
          const to = square + off;
          if (!onBoard(to)) continue;
          const df = Math.abs(fileOf(to) - f);
          if (df > 2) continue;
          const target = this.board.get(to);
          if (!target || target.color !== p.color) pushMove(to, { captured: target || null });
        }
        break;
      }

      case PieceType.Bishop:
      case PieceType.Rook:
      case PieceType.Queen: {
        const dirs = p.type === PieceType.Bishop ? DIRS.bishop : (p.type === PieceType.Rook ? DIRS.rook : [...DIRS.bishop, ...DIRS.rook]);
        for (const off of dirs) {
          let to = square + off;
          while (onBoard(to) && Math.abs(fileOf(to) - fileOf(to - off)) <= 1) {
            const target = this.board.get(to);
            if (!target) { pushMove(to); to += off; continue; }
            if (target.color !== p.color) pushMove(to, { captured: target });
            break;
          }
        }
        break;
      }

      case PieceType.King: {
        for (const off of DIRS.king) {
          const to = square + off;
          if (!onBoard(to)) continue;
          if (Math.abs(fileOf(to) - f) > 1) continue;
          const target = this.board.get(to);
          if (!target || target.color !== p.color) pushMove(to, { captured: target || null });
        }
        if (p.color === Color.White) {
          if (this.castlingRights.K) {
            const f1 = 5, g1 = 6, e1 = 4;
            if (!this.board.get(f1) && !this.board.get(g1)) pushMove(g1, { isCastling: true });
          }
          if (this.castlingRights.Q) {
            const d1 = 3, c1 = 2, b1 = 1, e1 = 4;
            if (!this.board.get(d1) && !this.board.get(c1) && !this.board.get(b1)) pushMove(c1, { isCastling: true });
          }
        } else {
          if (this.castlingRights.k) {
            const f8 = 61, g8 = 62; if (!this.board.get(f8) && !this.board.get(g8)) pushMove(g8, { isCastling: true });
          }
          if (this.castlingRights.q) {
            const d8 = 59, c8 = 58, b8 = 57; if (!this.board.get(d8) && !this.board.get(c8) && !this.board.get(b8)) pushMove(c8, { isCastling: true });
          }
        }

        break;
      }
    }

    const legal: Move[] = [];
    for (const m of moves) {
      this.makeMove(m);
      const inCheck = this.isInCheck(p.color);
      this.unmakeMove();
      if (!inCheck) legal.push(m);
    }

    return legal;
  }

  generateAllMoves(): Move[] {
    const moves: Move[] = [];
    for (let s = 0; s < 64; s++) {
      const p = this.board.get(s);
      if (p && p.color === this.activeColor) moves.push(...this.generateMovesFor(s));
    }
    return moves;
  }

  makeMove(move: Move) {
    const piece = this.board.get(move.from);
    if (!piece) throw new Error('No piece on from');

    const full: Move = { ...move, captured: this.board.get(move.to) };
    this.history.push(full);

    if (move.isEnPassant) {
      const capSq = this.activeColor === Color.White ? move.to - 8 : move.to + 8;
      full.captured = this.board.get(capSq);
      this.board.set(capSq, null);
    }

    if (move.isCastling) {
      if (piece.color === Color.White) {
        if (move.to === 6) { 
          this.board.set(7, null);
          this.board.set(5, { type: PieceType.Rook, color: Color.White });
        } else if (move.to === 2) {
          this.board.set(0, null);
          this.board.set(3, { type: PieceType.Rook, color: Color.White });
        }
      } else {
        if (move.to === 62) { 
          this.board.set(63, null);
          this.board.set(61, { type: PieceType.Rook, color: Color.Black });
        } else if (move.to === 58) {
          this.board.set(56, null);
          this.board.set(59, { type: PieceType.Rook, color: Color.Black });
        }
      }
    }

    this.board.set(move.from, null);
    const moved: Piece = { ...piece };
    if (move.promotion) moved.type = move.promotion;
    this.board.set(move.to, moved);

    if (piece.type === PieceType.King) {
      if (piece.color === Color.White) { this.castlingRights.K = false; this.castlingRights.Q = false; }
      else { this.castlingRights.k = false; this.castlingRights.q = false; }
    }
    if (piece.type === PieceType.Rook) {
      if (move.from === 0) this.castlingRights.Q = false;
      if (move.from === 7) this.castlingRights.K = false;
      if (move.from === 56) this.castlingRights.q = false;
      if (move.from === 63) this.castlingRights.k = false;
    }

    if (full.captured && full.captured.type === PieceType.Rook) {
      if (move.to === 0) this.castlingRights.Q = false;
      if (move.to === 7) this.castlingRights.K = false;
      if (move.to === 56) this.castlingRights.q = false;
      if (move.to === 63) this.castlingRights.k = false;
    }

    this.enPassantSquare = null;
    if (piece.type === PieceType.Pawn && Math.abs(move.to - move.from) === 16) {
      const ep = (move.from + move.to) / 2;
      this.enPassantSquare = ep;
    }

    if (piece.type === PieceType.Pawn || full.captured) this.halfmoveClock = 0; else this.halfmoveClock++;

    if (this.activeColor === Color.Black) this.fullmoveNumber++;
    this.activeColor = this.activeColor === Color.White ? Color.Black : Color.White;
  }

  unmakeMove() {
    const move = this.history.pop();
    if (!move) throw new Error('No move to undo');
    this.activeColor = this.activeColor === Color.White ? Color.Black : Color.White;

    const moved = this.board.get(move.to);
    if (move.promotion && moved) moved.type = PieceType.Pawn;

    this.board.set(move.from, moved ? { ...moved } : null);

    if (move.isEnPassant) {
      const capSq = this.activeColor === Color.White ? move.to - 8 : move.to + 8;
      this.board.set(capSq, move.captured || null);
      this.board.set(move.to, null);
    } else {
      this.board.set(move.to, move.captured || null);
    }

    if (move.isCastling) {
      if (this.activeColor === Color.White) {
        if (move.to === 6) { 
          this.board.set(5, null);
          this.board.set(7, { type: PieceType.Rook, color: Color.White });
        } else if (move.to === 2) {
          this.board.set(3, null);
          this.board.set(0, { type: PieceType.Rook, color: Color.White });
        }
      } else {
        if (move.to === 62) {
          this.board.set(61, null);
          this.board.set(63, { type: PieceType.Rook, color: Color.Black });
        } else if (move.to === 58) {
          this.board.set(59, null);
          this.board.set(56, { type: PieceType.Rook, color: Color.Black });
        }
      }
    }

  }

  isCheckmate(): boolean {
    if (!this.isInCheck(this.activeColor)) return false;
    const moves = this.generateAllMoves();
    return moves.length === 0;
  }

  isStalemate(): boolean {
    if (this.isInCheck(this.activeColor)) return false;
    const moves = this.generateAllMoves();
    return moves.length === 0;
  }
}
export default Game;

// Mister AL💦
