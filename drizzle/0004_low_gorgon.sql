ALTER TABLE "incident_progress" DROP CONSTRAINT "incident_progress_pkey";--> statement-breakpoint
ALTER TABLE "incident_progress" ADD COLUMN "sequence" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "incident_progress_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "incident_progress" ADD CONSTRAINT "incident_progress_pkey" PRIMARY KEY ("sequence");--> statement-breakpoint
CREATE INDEX "incident_progress_incident_id_idx" ON "incident_progress" USING btree ("incident_id");
