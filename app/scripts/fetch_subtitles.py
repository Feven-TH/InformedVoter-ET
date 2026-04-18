import random
import os
import json
import time
from pytube import Playlist
from youtube_transcript_api import YouTubeTranscriptApi
from dotenv import load_dotenv

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
RAW_DIR = os.path.join(BASE_DIR, "data", "raw")

load_dotenv()
PLAYLIST_URL = os.getenv("YOUTUBE_PLAYLIST_URL")


def get_video_urls(playlist_url):
    playlist = Playlist(playlist_url)
    return list(playlist.video_urls)


def extract_video_id(url):
    if "v=" in url:
        return url.split("v=")[1].split("&")[0]
    return None

def already_processed(video_id):
    path = os.path.join(RAW_DIR, f"{video_id}.json")
    return os.path.exists(path)

def fetch_transcript(video_id):
    api = YouTubeTranscriptApi()
    transcript = api.fetch(video_id, languages=["am", "en"])

    return [
        {
            "text": entry.text,
            "start": entry.start,
            "duration": entry.duration
        }
        for entry in transcript
    ]


def save_transcript(video_id, transcript):
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, f"{video_id}.json")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(transcript, f, ensure_ascii=False, indent=2)

    print(f"Saved: {os.path.abspath(path)}")


def main():
    if not PLAYLIST_URL:
        raise ValueError("YOUTUBE_PLAYLIST_URL not found in .env")

    print("Fetching playlist videos...\n")

    video_urls = get_video_urls(PLAYLIST_URL)
    print(f"Found {len(video_urls)} videos.\n")

    success_count = 0
    fail_count = 0

    for url in video_urls:
        video_id = extract_video_id(url)

        if not video_id:
            print(f"Skipping invalid URL: {url}")
            fail_count += 1
            continue
        if already_processed(video_id):
            print(f"Already processed: {video_id}")
            continue

        print(f"Processing video: {video_id}")

        try:
            transcript = fetch_transcript(video_id)

            if not transcript:
                print(f" Empty transcript for {video_id}")
                fail_count += 1
                continue

            save_transcript(video_id, transcript)
            success_count += 1

        except Exception as e:
            print(f"Failed for {video_id}: {e}")
            fail_count += 1

        # Smart delay (avoid blocking)
        time.sleep(random.uniform(3, 7))

    print("\n--- Summary ---")
    print(f"Successful: {success_count}")
    print(f"Failed: {fail_count}")


if __name__ == "__main__":
    main()