#!/usr/bin/env python3
"""Publish a generated EzProctor campaign using LinkedIn's official APIs."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


API_ROOT = "https://api.linkedin.com/rest"


def default_api_version() -> str:
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month - 1
    if month == 0:
        year, month = year - 1, 12
    return f"{year}{month:02d}"


def request(url: str, token: str, version: str, method: str = "POST", payload: dict | None = None, body: bytes | None = None, content_type: str = "application/json"):
    data = body if body is not None else (json.dumps(payload).encode("utf-8") if payload is not None else None)
    headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": content_type,
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            response_body = response.read()
            if response_body:
                try:
                    decoded = json.loads(response_body)
                except json.JSONDecodeError:
                    decoded = {"raw": response_body.decode("utf-8", errors="replace")}
            else:
                decoded = {}
            return response.status, response.headers, decoded
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LinkedIn API {method} {url} failed ({error.code}): {details}") from error


def upload_image(image_path: Path, owner: str, token: str, version: str) -> str:
    _, _, initialized = request(
        f"{API_ROOT}/images?action=initializeUpload",
        token,
        version,
        payload={"initializeUploadRequest": {"owner": owner}},
    )
    value = initialized.get("value", {})
    upload_url, image_urn = value.get("uploadUrl"), value.get("image")
    if not upload_url or not image_urn:
        raise RuntimeError(f"LinkedIn did not return an upload URL and image URN: {initialized}")
    request(upload_url, token, version, method="PUT", body=image_path.read_bytes(), content_type="image/png")
    return image_urn


def publish(post: dict, image_urn: str, owner: str, token: str, version: str) -> str:
    payload = {
        "author": owner,
        "commentary": post["commentary"],
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "content": {
            "media": {
                "id": image_urn,
                "altText": post["alt_text"],
            }
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }
    status, headers, _ = request(f"{API_ROOT}/posts", token, version, payload=payload)
    if status != 201:
        raise RuntimeError(f"Unexpected LinkedIn post status: {status}")
    return headers.get("x-restli-id", "published-id-not-returned")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", default="campaign-output", help="Generated campaign directory")
    args = parser.parse_args()

    token = os.environ.get("LINKEDIN_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("LINKEDIN_ACCESS_TOKEN is required. Store it as a GitHub Actions secret.")
    version = os.environ.get("LINKEDIN_API_VERSION", "").strip() or default_api_version()
    campaign_dir = Path(args.campaign).resolve()
    manifest = json.loads((campaign_dir / "manifest.json").read_text(encoding="utf-8"))
    owner = manifest.get("organization", "urn:li:organization:14490214")
    if owner != "urn:li:organization:14490214":
        raise SystemExit(f"Refusing to publish for unexpected organization: {owner}")

    for index, post in enumerate(manifest["posts"], start=1):
        image_urn = upload_image(campaign_dir / post["image"], owner, token, version)
        post_id = publish(post, image_urn, owner, token, version)
        print(f"Published post {index}: {post_id}")


if __name__ == "__main__":
    main()
