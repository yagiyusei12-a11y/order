-- セット項目「後から提供（別明細）」をゲストが選べるようにするフラグ
ALTER TABLE "MenuSetStep" ADD COLUMN "allowServeLaterSplit" BOOLEAN NOT NULL DEFAULT false;
