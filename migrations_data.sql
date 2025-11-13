--
-- PostgreSQL database dump
--

\restrict RzBu4VDxrc2HjGBBKt6Vr8NqmPiwLVttpvOa4kcV76enm2WeULcb83WyQtcxUFq

-- Dumped from database version 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: migrations; Type: TABLE DATA; Schema: public; Owner: curator_app
--

COPY public.migrations (id, name, hash, executed_at) FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2025-10-26 11:25:41.237262
1	create_users_table	f9d4095b2716918f560fdcc5434be9a2ad0dac3b	2025-10-26 11:25:41.286331
2	create_curation_tables	2e2b484582d1e41a8fadad2c6283694c82597946	2025-10-26 11:25:41.311652
3	alter_users_email	ba1af062646e8911a1c6d89e5e4d806f04d1c310	2025-10-29 16:28:20.424091
4	cleanup_public_curator	9aef4a68f9c4dd98c11a901df6fc8c2521be2241	2025-11-02 20:46:28.954274
5	create_cities_table	b9a4ca8167537f6c59556b93a3612d8a27999dec	2025-11-07 15:24:39.12447
6	alter_cities_for_autocomplete	7b90e74773731b3263fffd99046e7a40ab5587c0	2025-11-08 09:44:43.499876
7	add_trigram_support	4198247b0e94f307d39fed2619b78c8d3efb4ebf	2025-11-08 10:26:35.614315
8	add_unique_constraint_to_city_name	769fce740a373763eff716bb2f63af2c7f4aa139	2025-11-08 12:53:46.085303
9	remove_unique_constraint_to_city_name	96c03f1078630d561373c4d798c476733ad1ee64	2025-11-08 13:13:31.21393
10	re_add_unique_constraint_to_cities	8f4ca564dc14cc4f090a299caab2db52211dcb8a	2025-11-08 13:32:05.723866
11	create_playlist_jobs_table	9a9a5fe8da168e4d43a6e929983690a09b45328b	2025-11-11 12:59:20.763214
12	add_index_to_jobs_table	a2ccab118d15cdbe1ce3fb87fa6a12d31085c35b	2025-11-11 16:36:49.686546
\.


--
-- PostgreSQL database dump complete
--

\unrestrict RzBu4VDxrc2HjGBBKt6Vr8NqmPiwLVttpvOa4kcV76enm2WeULcb83WyQtcxUFq

