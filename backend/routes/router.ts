import express from 'express'
import { GetContextAnime, SearchAnimeSentence, mergeMp3Files } from "../controllers/mediaController"
export const router = express.Router()
const path = require('path');

router.post('/search/anime/sentence', SearchAnimeSentence)
router.post('/search/anime/context',GetContextAnime)
router.post('/utility/merge/audio', mergeMp3Files)