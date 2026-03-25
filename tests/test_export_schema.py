import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_fake_tfmkt_runner(tmp_path: Path) -> Path:
    fake_runner = tmp_path / "fake_tfmkt_runner.py"
    fake_runner.write_text(
        """
import json
import re
import sys


def read_parents():
    payload = sys.stdin.read()
    if not payload.strip():
        return []
    return [json.loads(line) for line in payload.splitlines() if line.strip()]


def emit(items):
    for item in items:
        print(json.dumps(item), flush=True)


def team_id_from_href(href):
    match = re.search(r"/verein/(\\d+)", href or "")
    return int(match.group(1)) if match else 0


def main():
    args = sys.argv[1:]

    # Probe call from detectPythonCommand in export-leagues.ts
    if "-c" in args:
        return 0

    if len(args) < 3 or args[0] != "-m" or args[1] != "tfmkt":
        return 1

    crawler = args[2]
    parents = read_parents()

    if crawler == "confederations":
        emit([
            {"type": "confederation", "href": "/wettbewerbe/europa"},
        ])
        return 0

    if crawler == "competitions":
        emit([
            {
                "type": "competition",
                "href": "/1-hnl/startseite/wettbewerb/KR1",
                "competition_type": "first_tier",
                "competition_name": "1. HNL",
                "country_name": "Croatia",
                "country_code": "KR1",
            },
            {
                "type": "competition",
                "href": "/championship/startseite/wettbewerb/GB2",
                "competition_type": "second_tier",
                "competition_name": "Championship",
                "country_name": "England",
                "country_code": "GB1",
            }
        ])
        return 0

    if crawler == "clubs":
        items = []
        for parent in parents:
            parent_href = parent.get("href", "")
            if "/wettbewerb/GB2" in parent_href:
                items.extend(
                    [
                        {
                            "type": "club",
                            "href": "/leeds-united/startseite/verein/399",
                            "parent": parent,
                            "name": "Leeds United",
                            "code": "leeds-united",
                            "club_image_url": "https://img.example.com/club-399.png",
                            "competition_image_url": "https://img.example.com/comp-GB2.png",
                        },
                        {
                            "type": "club",
                            "href": "/sheffield-united/startseite/verein/350",
                            "parent": parent,
                            "name": "Sheffield United",
                            "code": "sheffield-united",
                            "club_image_url": "https://img.example.com/club-350.png",
                            "competition_image_url": "https://img.example.com/comp-GB2.png",
                        },
                    ]
                )
            else:
                items.extend(
                    [
                        {
                            "type": "club",
                            "href": "/hnk-sibenik/startseite/verein/223",
                            "parent": parent,
                            "name": "HNK Sibenik",
                            "code": "hnk-sibenik",
                            "club_image_url": "https://img.example.com/club-223.png",
                            "competition_image_url": "https://img.example.com/comp-KR1.png",
                        },
                        {
                            "type": "club",
                            "href": "/hnk-hajduk-split/startseite/verein/447",
                            "parent": parent,
                            "name": "HNK Hajduk Split",
                            "code": "hnk-hajduk-split",
                            "club_image_url": "https://img.example.com/club-447.png",
                            "competition_image_url": "https://img.example.com/comp-KR1.png",
                        },
                    ]
                )
        emit(items)
        return 0

    if crawler == "countries":
        emit(
            [
                {
                    "type": "country",
                    "href": "/wettbewerbe/national/wettbewerbe/191",
                    "country_id": "191",
                    "country_name": "Wales",
                    "country_code": "GB-WAL",
                }
            ]
        )
        return 0

    if crawler == "national_teams":
        items = []
        for parent in parents:
            items.append(
                {
                    "type": "national_team",
                    "href": "/wales/startseite/verein/3864",
                    "parent": parent,
                    "team_level": "senior",
                    "team_label": "Wales",
                    "name": "Wales",
                    "code": "wales",
                    "team_image_url": "https://img.example.com/wales-team.png",
                    "fifa_ranking": "12",
                }
            )
        emit(items)
        return 0

    if crawler == "players":
        items = []
        for parent in parents:
            parent_href = parent.get("href", "")
            team_id = team_id_from_href(parent_href)
            if parent.get("type") == "national_team":
                items.append(
                    {
                        "type": "player",
                        "href": "/joe-allen/profil/spieler/12345",
                        "parent": {"href": parent_href},
                        "name": "Joe",
                        "last_name": "Allen",
                        "date_of_birth": "1990-03-14",
                        "citizenship": "Wales",
                        "height": "1.68 m",
                        "image_url": "https://img.example.com/player-12345.png",
                        "position": "Central Midfield",
                        "number": "7",
                    }
                )
            else:
                items.append(
                    {
                        "type": "player",
                        "href": f"/player-{team_id}/profil/spieler/{1000 + team_id}",
                        "parent": {"href": parent_href},
                        "name": "Test",
                        "last_name": f"Player{team_id}",
                        "date_of_birth": "2000-01-01",
                        "citizenship": "Croatia",
                        "height": "1.80 m",
                        "image_url": f"https://img.example.com/player-{1000 + team_id}.png",
                        "position": "Defender",
                        "number": "4",
                    }
                )
        emit(items)
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
""".strip()
        + "\n",
        encoding="utf8",
    )
    return fake_runner


def _run_export(tmp_path: Path, args: list[str]) -> list[dict]:
    fake_runner = _write_fake_tfmkt_runner(tmp_path)
    out_path = tmp_path / "out.json"

    cmd = [
        "node",
        "--experimental-strip-types",
        "./export-leagues.ts",
        *args,
        "--out",
        str(out_path),
    ]

    env = os.environ.copy()
    env["TFMKT_PYTHON_BIN"] = f"{sys.executable} {fake_runner}"

    result = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, (
        f"Export command failed:\nstdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    )

    return json.loads(out_path.read_text(encoding="utf8"))


def test_export_leagues_includes_team_and_competition_logos(tmp_path):
    data = _run_export(
        tmp_path,
        [
            "--mode",
            "leagues",
            "--league-ids",
            "KR1",
            "--seasons",
            "2025",
        ],
    )

    assert len(data) == 1
    league = data[0]
    assert "logo" in league
    assert league["logo"] == "https://img.example.com/comp-KR1.png"
    assert "country" in league
    assert "seasons" in league

    teams = league["seasons"][0]["teams"]
    assert len(teams) >= 1
    for team in teams:
        assert "logo" in team
        assert team["logo"] is not None
        assert "players" in team

    first_player = teams[0]["players"][0]
    assert "photo" in first_player
    assert first_player["photo"] is not None


def test_export_nations_includes_team_logo_and_null_competition_logo(tmp_path):
    data = _run_export(
        tmp_path,
        [
            "--mode",
            "nations",
            "--seasons",
            "2025",
            "--country-codes",
            "GB",
            "--squad-levels",
            "senior",
        ],
    )

    assert len(data) == 1
    competition = data[0]
    assert "logo" in competition
    assert competition["logo"] is None

    teams = competition["seasons"][0]["teams"]
    assert len(teams) == 1
    assert teams[0]["logo"] == "https://img.example.com/wales-team.png"


def test_export_leagues_supports_non_first_tier_competition_ids(tmp_path):
    data = _run_export(
        tmp_path,
        [
            "--mode",
            "leagues",
            "--league-ids",
            "GB2",
            "--seasons",
            "2025",
        ],
    )

    assert len(data) == 1
    league = data[0]
    assert league["id"] == "GB2"
    assert league["name"] == "Championship"
    assert league["logo"] == "https://img.example.com/comp-GB2.png"
    assert league["country"]["name"] == "England"
    assert league["seasons"][0]["year"] == 2025
    assert len(league["seasons"][0]["teams"]) == 2
