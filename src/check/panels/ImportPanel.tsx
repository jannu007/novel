import { useCallback, useState } from 'react';
import { isStandalone } from '../browser';

interface Props {
  onFile: (file: File) => void;
  loading: boolean;
  error: string | null;
}

const ACCEPT = '.epub,application/epub+zip';

export default function ImportPanel({ onFile, loading, error }: Props) {
  const [over, setOver] = useState(false);

  const take = useCallback(
    (list: FileList | File[] | null) => {
      const files = list ? [...list] : [];
      const file = files.find((f) => /\.epub$/i.test(f.name)) ?? files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    take(e.target.files);
    e.target.value = '';
  };

  return (
    <div className="card">
      <h2>EPUBを読み込む</h2>
      <p className="hint">
        「製本所」などで作ったEPUBファイルを渡すと、Amazonの商品ページに近い形で下見できます。
        表紙・題名・紹介文・目次の見え方を、出版する前に確かめられます。
      </p>

      <label
        className={`dropzone${over ? ' over' : ''}`}
        htmlFor="check-pick"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <b>{loading ? '読み込んでいます…' : 'EPUBファイルを選ぶ'}</b>
        <span>.epub をドラッグ＆ドロップ、またはタップして選択</span>
      </label>

      <input id="check-pick" type="file" accept={ACCEPT} className="file-input" onChange={onPicked} />

      <div className="btn-row" style={{ marginTop: 12 }}>
        <label className="btn primary" htmlFor="check-pick">
          ファイルを選ぶ
        </label>
      </div>

      {isStandalone() && (
        <p className="hint" style={{ marginTop: 10 }}>
          端末のファイル一覧で .epub を選んだときの「アプリで開く」からも渡せます。
        </p>
      )}

      {error && (
        <div className="notice danger" style={{ marginTop: 12 }}>
          <span aria-hidden="true">⚠</span>
          <div>
            <b>読み込めませんでした</b>
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
