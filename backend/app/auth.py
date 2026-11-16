"""Single-admin access for Y700, with signed HTTPS-only session cookies."""
import hmac
import os
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

router = APIRouter()
COOKIE = "rm3d_session"
SESSION_SECONDS = 8 * 3600
ATTEMPTS = defaultdict(list)


def production():
    return os.environ.get("APP_ENV") == "production"


def check_configuration():
    if production():
        if len(os.environ.get("RM3D_ADMIN_PASSWORD","")) < 14:
            raise RuntimeError("RM3D_ADMIN_PASSWORD must contain at least 14 characters")
        if len(os.environ.get("RM3D_SESSION_KEY","")) < 32:
            raise RuntimeError("RM3D_SESSION_KEY must contain at least 32 characters")
        if not os.environ.get("DATABASE_URL"):
            raise RuntimeError("DATABASE_URL required in Y700 production")


def serializer():
    return URLSafeTimedSerializer(os.environ["RM3D_SESSION_KEY"],salt="rm3d-web-login")


def allowed(request: Request) -> bool:
    if not production():
        return True
    cookie = request.cookies.get(COOKIE,"")
    if not cookie:
        return False
    try:
        return serializer().loads(cookie,max_age=SESSION_SECONDS) == "administrator"
    except (BadSignature,SignatureExpired):
        return False


class Credentials(BaseModel):
    password: str


@router.get("/api/auth/me")
def me(request: Request):
    if not allowed(request):
        raise HTTPException(401,"Inicia sesión")
    return {"authenticated":True}


@router.post("/api/auth/login")
def login(credentials: Credentials, request: Request, response: Response):
    if not production():
        return {"authenticated":True}
    identifier = request.client.host if request.client else "unknown"
    now = time.monotonic()
    previous = [t for t in ATTEMPTS[identifier] if now-t < 900]
    ATTEMPTS[identifier] = previous
    if len(previous) >= 20:
        raise HTTPException(429,"Demasiados intentos; inténtalo más tarde")
    valid = hmac.compare_digest(
        credentials.password.encode("utf-8"),
        os.environ["RM3D_ADMIN_PASSWORD"].encode("utf-8"),
    )
    if not valid:
        ATTEMPTS[identifier].append(now)
        raise HTTPException(401,"Contraseña incorrecta")
    ATTEMPTS.pop(identifier,None)
    response.set_cookie(
        COOKIE,serializer().dumps("administrator"),max_age=SESSION_SECONDS,
        httponly=True,secure=True,samesite="strict",path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated":True}


@router.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE,path="/",secure=True,httponly=True,samesite="strict")
    return {"authenticated":False}


async def protect_api(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in (
        "/api/auth/login","/api/auth/me","/api/health",
    ):
        if not allowed(request):
            return JSONResponse({"detail":"Inicio de sesión requerido"},status_code=401)
    if production() and request.method in ("POST","PUT","PATCH","DELETE") and path.startswith("/api/"):
        origin = request.headers.get("origin")
        expected = os.environ.get("PUBLIC_ORIGIN","https://rm3d.alexistorreslabs.com")
        if origin and origin.rstrip("/") != expected.rstrip("/"):
            return JSONResponse({"detail":"Origen no permitido"},status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail":"Origen no permitido"},status_code=403)
    result = await call_next(request)
    result.headers["Cache-Control"] = "no-store" if path.startswith("/api/") else "no-cache"
    result.headers["X-Content-Type-Options"] = "nosniff"
    result.headers["Referrer-Policy"] = "no-referrer"
    result.headers["X-Frame-Options"] = "DENY"
    return result
