import os
import json
import re

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
RAW_DIR = os.path.join(BASE_DIR, "data", "raw")
PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")
MAX_WORDS = 100

def load_transcript(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

def clean_text(text):
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def chunk_transcript_with_timestamps(transcript, video_id):
    """
    Groups raw subtitle entries into chunks based on word count 
    while preserving the timestamp of the first entry in each chunk.
    """
    chunks = []
    current_batch_text = []
    current_word_count = 0
    chunk_id = 0
    
    # We track the start time of the very first entry in the current batch
    batch_start_time = transcript[0]['start'] if transcript else 0
    current_speaker = "unknown"

    for entry in transcript:
        text = clean_text(entry['text'])
        
        # Handle Speaker Change marker if present in text
        if ">>" in text:
            current_speaker = f"speaker_{chunk_id}"
            text = text.replace(">>", "").strip()

        words = text.split()
        count = len(words)

        # If adding this entry exceeds MAX_WORDS, save current batch and start new
        if current_word_count + count > MAX_WORDS and current_batch_text:
            combined_text = " ".join(current_batch_text)
            chunks.append(build_chunk(
                combined_text, video_id, chunk_id, batch_start_time, current_speaker
            ))
            
            # Reset for next chunk
            chunk_id += 1
            current_batch_text = []
            current_word_count = 0
            batch_start_time = entry['start'] # New chunk starts at this entry's time

        current_batch_text.append(text)
        current_word_count += count

    # Final chunk
    if current_batch_text:
        chunks.append(build_chunk(
            " ".join(current_batch_text), video_id, chunk_id, batch_start_time, current_speaker
        ))

    return chunks

def build_chunk(text, video_id, chunk_id, start_time, speaker):
    # Rounding start_time to int for the YouTube URL ?t=XXs format
    start_seconds = int(start_time)
    return {
        "text": text,
        "video_id": video_id,
        "chunk_id": chunk_id,
        "word_count": len(text.split()),
        "start_time": start_seconds,
        "speaker": speaker,
        "url": f"https://youtu.be/{video_id}?t={start_seconds}s"
    }

def save_chunks(video_id, chunks):
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    path = os.path.join(PROCESSED_DIR, f"{video_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    print(f"Processed: {video_id} -> {len(chunks)} chunks")

def process_all():
    if not os.path.exists(RAW_DIR):
        print(f"Error: {RAW_DIR} does not exist.")
        return

    files = [f for f in os.listdir(RAW_DIR) if f.endswith(".json")]
    for file in files:
        video_id = file.replace(".json", "")
        file_path = os.path.join(RAW_DIR, file)
        
        try:
            transcript = load_transcript(file_path)
            if not transcript: continue
            
            chunks = chunk_transcript_with_timestamps(transcript, video_id)
            save_chunks(video_id, chunks)
        except Exception as e:
            print(f"Failed {video_id}: {e}")

if __name__ == "__main__":
    process_all()