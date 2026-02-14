export interface MorphemeData {
  surface: string;
  reading: string;
  baseform: string;
  pronunciation: string;
  pos: string[];
  posShort: string;
  begin: number;
  end: number;
  pitchAccentType: number[] | null;
  pitchCompoundRule: string | null;
  pitchModificationRule: string | null;
}
