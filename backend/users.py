import sqlite3
from typing import Optional

from .auth import hash_password, verify_password
from .db import get_connection


class UsernameTakenError(Exception):
    pass


def create_user(username: str, password: str) -> int:
    password_hash = hash_password(password)
    with get_connection() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
        except sqlite3.IntegrityError as e:
            raise UsernameTakenError(username) from e
        return cursor.lastrowid


def verify_user(username: str, password: str) -> Optional[int]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
    if row is None or not verify_password(password, row["password_hash"]):
        return None
    return row["id"]


def add_score(user_id: int, amount: int):
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET total_score = total_score + ? WHERE id = ?",
            (amount, user_id),
        )


def get_user(user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, total_score FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def get_leaderboard(limit: int = 25) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT username, total_score FROM users ORDER BY total_score DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]
