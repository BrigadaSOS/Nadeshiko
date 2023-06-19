import express from 'express'
import { GetContextAnime, SearchAnimeSentences, mergeMp3Files } from "../controllers/mediaController"
export const router = express.Router()
const path = require('path');

router.post('/search/anime/sentence', SearchAnimeSentences)
router.post('/search/anime/context',GetContextAnime)
router.post('/utility/merge/audio', mergeMp3Files)

