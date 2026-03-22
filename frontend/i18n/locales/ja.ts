export default {
  "navbar": {
    "buttons": {
      "home": "ホーム",
      "about": "About",
      "login": "ログイン / サインアップ",
      "profile": "プロフィール",
      "privacy": "プライバシー",
      "dmca": "DMCA",
      "terms": "利用規約",
      "settings": "設定",
      "blog": "ブログ",
      "media": "メディア",
      "language": "言語"
    }
  },
  "home": {
    "version": "v{version}",
    "nadeDbDescription": "さまざまな文脈から日本語の文を検索できるツール。",
    "nadeDbDescriptionJpSearch": "日本語で検索",
    "nadeDbDescriptionOtherSearch": "英語またはスペイン語で検索",
    "nadeDbDescriptionExclusiveSearch": "限定検索",
    "nadeDbDescriptionExactSearch": "完全一致検索",
    "keyFeatures": {
      "feature1": {
        "title": "Ankiと互換性あり",
        "description": "画像、音声、複数の言語を含む文をAnkiに保存できます。"
      },
      "feature2": {
        "title": "文を保存",
        "description": "画像、音声、動画などの形式で文を保存できます。"
      },
      "feature3": {
        "title": "文の前後の文脈を確認",
        "description": "文の前後の流れを確認できます。"
      },
      "feature4": {
        "title": "多様で豊富なコンテンツ",
        "description": "さまざまなジャンル、メディア、声を楽しめます。"
      }
    },
    "support": {
      "title": "Nadeshikoを応援しませんか？",
      "description": "このサイトが役に立った場合は、GitHubでの支援、寄付、またはこのサイトを共有することで、今後の開発をサポートできます。"
    },
    "stats": {
      "sentenceCount": "文",
      "episodeCount": "エピソード",
      "mediaCount": "総コンテンツ数"
    }
  },
  "batchSearch": {
    "title": "同時検索",
    "description1": "この機能を使うと、複数の単語を一度に検索できます。データベース内で見つかった単語のリストと、その検索へのリンクが表示されます。",
    "description2": "まずは下のボックスに単語を入力してください。",
    "description3": "1行に1単語、またはカンマ区切りで入力してください。",
    "description4": "最大検索数：",
    "description5": "500単語まで",
    "totalWords": "合計単語数",
    "search": "検索",
    "close": "閉じる",
    "results": {
      "title": "同時検索 - 結果",
      "words": "検索した単語",
      "wordsWithMatch": "一致した単語",
      "percentageMatched": "一致率",
      "wordColumn": "単語",
      "match": "一致？",
      "matchesCount": "一致数",
      "true": "はい",
      "false": "いいえ",
      "searching": "検索中...",
      "return": "戻る"
    }
  },
  "animeList": {
    "recentlyAddedTitle": "最近追加されたもの",
    "fullListTitle": "コンテンツ一覧",
    "seeAll": "すべて見る",
    "sentenceCount": "文",
    "episodes": "エピソード",
    "sentenceCountLabel": "文:",
    "anilistButton": "Anilist",
    "vocabularyButton": "語彙"
  },
  "mediaBrowse": {
    "showHiddenMedia": "非表示の作品を表示",
    "hideHiddenMedia": "非表示の作品を隠す"
  },
  "searchSettingsModal": {
    "exactMatchTitle": "完全一致検索",
    "exactMatchDescription": "活用形やその他の結果を含めずに、完全一致の検索を行います。"
  },
  "anki": {
    "modal": {
      "title": "コレクション内を検索",
      "description": "Ankiにあるカードを検索し、画像や音声を追加できます。「キーフィールド」が設定タブで設定されている必要があります。",
      "idColumn": "ID",
      "keyColumn": "キー",
      "noCardsFound": "カードが見つかりません",
      "noCardsMessage": "別のクエリを試すか、まず文をマイニングしてください",
      "validationSuccess": "検証成功",
      "validationMessage": "キーフィールドが設定されています！",
      "validationError": "エラーが発生しました",
      "errorMessage": "キーフィールドが定義されていません",
      "errorTip": "Nadeshikoの設定でキーフィールドが定義されていることを確認してください"
    },
    "toast": {
      "noSettings": "設定が見つかりません。設定ページで拡張機能を設定してください。",
      "miningCard": "カードを処理中...",
      "noCardToExport": "エクスポート先のAnkiカードがありません。まずカードを追加してください。",
      "cardAdded": "カードがAnkiに正常に追加されました",
      "cardAddError": "Ankiにカードを追加できませんでした。エラー: {error}"
    }
  },
  "modalAnkiNotes": {
    "closeSrOnly": "閉じる",
    "searchPlaceholder": "女"
  },
  "modalBatch": {
    "closeSrOnly": "閉じる",
    "wordLimitExceeded": "単語数の上限を超えました: {count} / 500",
    "inputFormatError": "入力形式が正しくありません。カンマと改行が同時に含まれていないか確認してください。",
    "notAvailable": "利用不可",
    "searchTypeLabel": "検索タイプ: {type}",
    "searchTypeExact": "完全一致",
    "searchTypeNormal": "通常",
    "examplePlaceholder": "彼女\n彼氏\n走る\n恋人\n...\n...\n..."
  },
  "modalContext": {
    "closeSrOnly": "閉じる"
  },
  "modalMediaEdit": {
    "title": "メディア編集",
    "editButton": "編集",
    "nameJa": "日本語名",
    "nameRomaji": "ローマ字名",
    "nameEn": "英語名",
    "airingFormat": "形式",
    "airingStatus": "放送状況",
    "category": "カテゴリ",
    "genres": "ジャンル",
    "genresPlaceholder": "コメディ, ドラマ, ロマンス",
    "studio": "スタジオ",
    "startDate": "開始日",
    "endDate": "終了日",
    "seasonName": "シーズン",
    "seasonYear": "年",
    "externalIds": "外部ID",
    "save": "保存",
    "saving": "保存中...",
    "cancel": "キャンセル",
    "close": "閉じる",
    "saveSuccess": "メディアを更新しました",
    "saveError": "メディアの更新に失敗しました",
    "delete": "削除",
    "deleteConfirm": "本当に削除しますか？",
    "confirmYes": "はい、削除",
    "confirmNo": "いいえ",
    "deleting": "削除中...",
    "deleteSuccess": "メディアを削除しました",
    "deleteError": "メディアの削除に失敗しました"
  },
  "modalSegmentEdit": {
    "title": "セグメント編集",
    "editButton": "編集",
    "japanese": "日本語",
    "english": "英語",
    "spanish": "スペイン語",
    "machineTranslated": "機械翻訳",
    "status": "ステータス",
    "contentRating": "コンテンツレーティング",
    "save": "保存",
    "saving": "保存中...",
    "cancel": "キャンセル",
    "close": "閉じる",
    "saveSuccess": "セグメントを更新しました",
    "saveError": "セグメントの更新に失敗しました",
    "timing": "位置とタイミング",
    "position": "位置",
    "startTimeMs": "開始 (ms)",
    "endTimeMs": "終了 (ms)",
    "ratingAnalysis": "レーティング分析",
    "ratingAnalysisDesc": "コンテンツレーティングの導出に使用されたWD Tagger v3分類器の出力（スコア/タグ）",
    "posAnalysis": "品詞分析",
    "posAnalysisDesc": "エンジン別の品詞トークン化結果（sudachi、unidic）",
    "invalidJson": "無効なJSON",
    "loading": "読み込み中...",
    "history": "履歴",
    "historyToggle": "履歴の切り替え",
    "snapshot": "スナップショット",
    "noRevisions": "編集履歴はまだありません",
    "viewingSnapshot": "スナップショット {n} を表示中",
    "current": "現在",
    "metadata": {
      "media": "メディア",
      "episode": "話",
      "time": "時間",
      "duration": "長さ",
      "id": "ID",
      "position": "位置",
      "uuid": "UUID",
      "copyUuid": "UUIDをコピー",
      "publicId": "公開ID",
      "copyPublicId": "公開IDをコピー",
      "mediaId": "メディアID",
      "hashedId": "ハッシュID",
      "storage": "ストレージ",
      "storagePath": "ストレージパス",
      "image": "画像",
      "audio": "音声",
      "video": "動画"
    }
  },
  "filterContent": {
    "searchPlaceholder": "ここで検索"
  },
  "episodeFilter": {
    "title": "エピソード",
    "clear": "クリア",
    "noEpisodes": "エピソードが見つかりませんでした"
  },
  "segmentSidebar": {
    "loading": "読み込み中..."
  },
  "searchpage": {
    "main": {
      "translationPreferences": {
        "englishShown": "英語翻訳を表示しました",
        "englishSpoiler": "英語翻訳をスポイラーモードにしました",
        "englishHidden": "英語翻訳を非表示にしました",
        "spanishShown": "スペイン語翻訳を表示しました",
        "spanishSpoiler": "スペイン語翻訳をスポイラーモードにしました",
        "spanishHidden": "スペイン語翻訳を非表示にしました",
        "furiganaShown": "ふりがな（読み）を表示しました",
        "furiganaSpoiler": "ふりがな（読み）をホバーで表示にしました",
        "furiganaHidden": "ふりがな（読み）を非表示にしました"
      },
      "buttons": {
        "addToAnkiLast": "Ankiに追加（最後に追加したカード）",
        "addToAnkiSearch": "Ankiに追加（コレクションを検索）",
        "download": "保存",
        "dl-expanded": "コンテクストオーディオ",
        "add": "追加",
        "video": "画像 + 音声",
        "image": "画像",
        "audio": "音声",
        "info": "エピソード情報",
        "copyclipboard": "コピー",
        "jpsentence": "日本語の文",
        "ensentence": "英語の文",
        "essentence": "スペイン語の文",
        "context": "文脈",
        "share": "共有",
        "more": "その他",
        "expandLeft": "左に展開",
        "expandBoth": "両側に展開",
        "expandRight": "右に展開",
        "hideMedia": "非表示",
        "unhideMedia": "表示",
        "addToCollection": "コレクションに追加",
        "manageCollections": "コレクションを管理",
        "collectionsLoading": "コレクションを読み込み中...",
        "collectionsEmpty": "コレクションがまだありません",
        "chooseCollection": "コレクションを選択...",
        "sortmain": "文を並び替え",
        "sortlengthnone": "なし",
        "sortlengthmin": "最短",
        "sortlengthmax": "最長",
        "sorttime_asc": "時系列順",
        "sorttime_desc": "逆順",
        "sortrandom": "ランダム"
      },
      "labels": {
        "contentList": "コンテンツ",
        "noresults": "結果が見つかりませんでした...",
        "episode": "エピソード",
        "movie": "映画",
        "searchmain": "タイトルを書いてください",
        "searchbar": "フィルター",
        "all": "すべて",
        "copiedcontent": "内容がクリップボードにコピーされました。",
        "copiedsharingurl": "URLがクリップボードにコピーされました。",
        "errorcopiedsharingurl": "URLのコピーに失敗しました。再試行してください。",
        "collectionAdded": "\"{name}\" に追加しました",
        "collectionAddFailed": "コレクションへの追加に失敗しました。再試行してください。",
        "mtTooltip": "この文は機械翻訳されたため、正確ではない可能性があります"
      }
    },
    "modalcontext": {
      "labels": {
        "context": "文脈"
      }
    }
  },
  "activity": {
    "deleteDayActivity": "この日のアクティビティを削除",
    "deletingDayActivity": "削除中..."
  },
  "accountSettings": {
    "menu": {
      "generalTitle": "一般",
      "advancedTitle": "高度な設定"
    },
    "tabs": {
      "sync": "Anki同期",
      "developer": "開発者"
    },
    "developer": {
      "apiUsageTitle": "API使用量",
      "apiUsageRemaining": "残りリクエスト: {used} / {limit}",
      "apiKeyManagement": "APIキー管理",
      "addApiKey": "APIキーを追加",
      "keyCreated": "キー作成完了",
      "keyCreatedMessage": "このキーを保存してください。再度表示されません。",
      "keyDeactivated": "キー無効化完了",
      "noKeysFound": "APIキーが見つかりません",
      "noKeysMessage": "アプリやプロジェクト用に新しいキーを作成しましょう！",
      "tableHeaders": {
        "name": "名前",
        "key": "キー",
        "permissions": "権限",
        "createdAt": "作成日",
        "status": "状態"
      },
      "statusActive": "有効",
      "statusInactive": "無効",
      "options": "オプション",
      "rename": "名前変更",
      "deactivate": "無効化",
      "createApiKeyModal": {
        "title": "APIキー作成",
        "nameLabel": "名前",
        "namePlaceholder": "このAPIキーの名前を入力してください",
        "create": "作成"
      },
      "renameApiKeyModal": {
        "title": "APIキーの名前変更",
        "nameLabel": "名前",
        "namePlaceholder": "このAPIキーの新しい名前を入力してください",
        "save": "保存"
      }
    },
    "account": {
      "infoTitle": "情報",
      "usernameLabel": "ユーザー名",
      "emailLabel": "メール",
      "notAvailable": "利用不可",
      "additionalTitle": "エキストラ",
      "deleteAccount": "アカウント削除（取り消し不可）",
      "questionableContent": "センシティブコンテンツ",
      "questionableContentDesc": "きわどいまたは露骨なコンテンツ",
      "contentRatingShow": "表示",
      "contentRatingBlur": "ぼかし（デフォルト）",
      "contentRatingHide": "非表示",
      "contentRatingHint_show": "検索結果に含まれ、ぼかしなしで表示されます",
      "contentRatingHint_blur": "検索結果に含まれますが、ぼかして表示されます",
      "contentRatingHint_hide": "検索結果に含まれません",
      "contentRatingPreview": "検索結果での表示プレビュー",
      "contentRatingHiddenDesc": "非表示 — 検索結果に含まれません",
      "preferenceSaved": "設定を保存しました",
      "preferenceError": "設定の保存に失敗しました",
      "changeEmail": "変更",
      "changeEmailPlaceholder": "新しいメールアドレス",
      "changeEmailSend": "確認メールを送信",
      "changeEmailSending": "送信中...",
      "changeEmailCancel": "キャンセル",
      "changeEmailSuccess": "現在のメールアドレスに確認メールを送信しました。受信トレイを確認してください。",
      "changeEmailFailed": "メールアドレスの変更リクエストに失敗しました。",
      "hiddenMedia": "非表示メディア",
      "hiddenMediaDescription": "検索結果から非表示にしたメディア。検索結果のメニューからも非表示にできます。",
      "hiddenMediaSearchPlaceholder": "非表示にするメディアを検索...",
      "hiddenMediaEmpty": "非表示のメディアはありません。検索結果にはすべてのメディアが表示されます。"
    },
    "collections": {
      "removeFromCollection": "コレクションから削除",
      "confirmRemove": "削除しますか？",
      "yes": "はい",
      "no": "いいえ",
      "rename": "名前を変更",
      "delete": "削除",
      "renameTitle": "コレクション名を変更",
      "renameConfirm": "保存",
      "renameCancel": "キャンセル",
      "renamed": "コレクション名を変更しました",
      "deleteTitle": "コレクションを削除",
      "deleteMessage": "「{name}」を削除しますか？この操作は取り消せません。",
      "deleteConfirm": "削除",
      "deleteCancel": "キャンセル",
      "deleted": "コレクションを削除しました",
      "visibility": {
        "PUBLIC": "公開",
        "PRIVATE": "非公開"
      },
      "noCollections": "コレクションはまだありません。",
      "makePublic": "公開にする",
      "makePrivate": "非公開にする",
      "visibilityTitle": "公開設定を変更",
      "makePublicMessage": "「{name}」を公開にしますか？誰でもこのコレクションを閲覧できるようになります。",
      "makePrivateMessage": "「{name}」を非公開にしますか？あなただけがこのコレクションを閲覧できます。",
      "visibilityConfirm": "確認",
      "visibilityChanged": "公開設定を更新しました",
      "visibilityError": "公開設定の更新に失敗しました",
      "createButton": "新規コレクション",
      "createTitle": "コレクションを作成",
      "createConfirm": "作成",
      "createSuccess": "コレクションを作成しました",
      "createError": "コレクションの作成に失敗しました",
      "nameLabel": "名前",
      "namePlaceholder": "マイコレクション"
    },
    "anki": {
      "syncStatus": "同期状態",
      "loading": "読み込み中...",
      "loadingMessage": "接続中です。お待ちください",
      "connectionSuccess": "接続成功",
      "successMessage": "Ankiとの接続が正常に確立されました",
      "connectionError": "エラーが発生しました",
      "errorMessage": "Ankiとの接続を確立できませんでした",
      "fieldLoadError": "モデルのフィールド名の読み込みエラー:",
      "troubleshootingTips": {
        "ankiRunning": "Ankiが起動中でAnkiconnectアドオンがインストールされていることを確認してください",
        "webCors": "AnkiConnectのwebCorsOriginList設定に'https://nadeshiko.co'が含まれていることを確認してください",
        "adBlock": "このドメインに対するAdBlock拡張機能を無効にしてください"
      },
      "ankiConfig": "Anki設定",
      "deckLabel": "デッキ",
      "selectDeck": "デッキを選択",
      "modelLabel": "モデル",
      "selectModel": "モデルを選択",
      "keyFieldLabel": "キーフィールド",
      "selectKeyField": "デッキIDに対応するフィールドを選択",
      "fieldColumn": "フィールド",
      "contentColumn": "内容",
      "noFieldsFound": "フィールドが見つかりません",
      "noFieldsMessage": "再度お試しいただくか、AnkiConnectの接続を確認してください",
      "serverAddressLabel": "AnkiConnectサーバーアドレス",
      "profile": "プロフィール",
      "newProfile": "新規",
      "deleteProfile": "削除",
      "saving": "保存中..."
    }
  },
  "errorPage": {
    "pageNotFound": "ページが見つかりません",
    "somethingWentWrong": "エラーが発生しました。",
    "goHome": "ホームへ戻る"
  },
  "contentPage": {
    "emptyMessage": "近日公開予定 😉"
  },
  "segment": {
    "noResultsTitle": "404",
    "noResultsMessage": "別の検索をお試しいただくか、{link} で検索してみてください",
    "contentRatingShow": "表示",
    "contentRatingHide": "非表示",
    "status": {
      "ACTIVE": "有効",
      "VERIFIED": "検証済み",
      "SUSPENDED": "停止中",
      "DELETED": "削除済み",
      "INVALID": "無効",
      "TOO_LONG": "長すぎる"
    },
    "contentRating": {
      "SAFE": "安全",
      "SUGGESTIVE": "示唆的",
      "QUESTIONABLE": "問題あり",
      "EXPLICIT": "露骨"
    },
    "nsfwTag": "NSFW",
    "contentRatingDescription": {
      "SENSITIVE": "センシティブコンテンツ（きわどい）"
    },
    "revert": "元に戻す"
  },
  "searchContainer": {
    "errorTitle": "502",
    "errorMessage1": "エラーが発生しました",
    "errorMessage2": "下のボタンで再試行してください。",
    "retryButton": "接続を再試行",
    "retrying": "再試行中...",
    "endOfResults": "最後まで到達しました！",
    "loadMore": "さらに文を読み込む",
    "categoryAll": "すべて",
    "categoryAnime": "アニメ",
    "categoryLiveaction": "実写",
    "collectionTabPrefix": "コレクション",
    "backToCollections": "コレクション一覧",
    "hiddenMediaNotice": "この作品は非表示リストに含まれています",
    "hiddenMediaDescription": "この作品は検索結果から非表示にされています。一時的に表示することができます。",
    "hiddenMediaShowAnyway": "表示する",
    "loading": "読み込み中..."
  },
  "reports": {
    "modalTitle": "問題を報告する",
    "targetLabel": "対象",
    "reason": "理由",
    "tabSegment": "セグメント",
    "tabMedia": "メディア",
    "description": "説明（任意）",
    "descriptionPlaceholder": "問題の詳細を入力してください...",
    "submit": "報告を送信",
    "submitting": "送信中...",
    "submitSuccess": "報告が送信されました",
    "submitError": "報告の送信に失敗しました",
    "cancel": "キャンセル",
    "reportSegment": "報告",
    "loginRequired": "この機能を使用するにはログインしてください",
    "allStatuses": "すべてのステータス",
    "noReports": "レポートが見つかりません",
    "loading": "読み込み中...",
    "loadMore": "もっと読み込む",
    "reasons": {
      "WRONG_TRANSLATION": "翻訳が間違っている",
      "WRONG_TIMING": "タイミングが間違っている",
      "WRONG_AUDIO": "音声が間違っている",
      "WRONG_JAPANESE_TEXT": "日本語テキストが間違っている",
      "LOW_QUALITY_AUDIO": "音声の品質が低い",
      "NSFW_NOT_TAGGED": "コンテンツ未分類",
      "DUPLICATE_SEGMENT": "重複セグメント",
      "WRONG_TITLE": "タイトルが間違っている",
      "DUPLICATE_MEDIA": "重複メディア",
      "WRONG_EPISODE_NUMBER": "エピソード番号が間違っている",
      "IMAGE_ISSUE": "画像の問題",
      "WRONG_METADATA": "メタデータが間違っている",
      "MISSING_EPISODES": "エピソードが不足している",
      "WRONG_COVER_IMAGE": "カバー画像が間違っている",
      "INAPPROPRIATE_CONTENT": "不適切なコンテンツ",
      "OTHER": "その他"
    },
    "statuses": {
      "PENDING": "保留中",
      "ACCEPTED": "承認済み",
      "REJECTED": "却下",
      "RESOLVED": "解決済み"
    },
    "table": {
      "type": "タイプ",
      "target": "対象",
      "reason": "理由",
      "status": "ステータス",
      "description": "説明"
    },
    "admin": {
      "title": "レポート管理",
      "reporter": "報告者",
      "count": "件数",
      "notes": "管理者メモ",
      "actions": "アクション",
      "accept": "承認",
      "reject": "却下",
      "resolve": "解決",
      "save": "保存",
      "addNote": "クリックしてメモを追加...",
      "updateSuccess": "レポートが更新されました"
    }
  },
  "modalauth": {
    "headers": {
      "auth": "認証"
    },
    "buttons": {
      "google": "Googleでログイン",
      "discord": "Discordでログイン"
    },
    "labels": {
      "successfullogin": "ログイン成功！",
      "logout": "ログアウトしました。",
      "errorlogin400": "メールアドレス/パスワードを確認して再試行してください。",
      "closeSrOnly": "閉じる"
    }
  },
  "shortcuts": {
    "title": "キーボードショートカット",
    "navigation": "ナビゲーション",
    "navigateCards": "結果間を移動",
    "prevNextSegment": "前 / 次のセグメント",
    "backToSearch": "検索バーに戻る",
    "playback": "再生",
    "playSelected": "選択した結果を再生",
    "playPause": "再生 / 一時停止",
    "restart": "音声をリスタート",
    "toggleAutoplay": "自動再生の切り替え",
    "toggleImmersive": "没入モードの切り替え",
    "actions": "アクション",
    "openAnki": "Ankiに追加",
    "openContext": "文脈を開く",
    "hint": "検索バーに入力中はショートカットが無効になります。?キーでこのパネルを表示/非表示できます。"
  }
}
